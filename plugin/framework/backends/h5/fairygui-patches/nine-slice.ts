// 补丁 12：九宫格在分数缩放下出细线（Blink：Chrome、Edge、安卓 WebView）。
// 上游用一个元素的 border-image 画九宫格；Blink 在根节点 transform 缩放后的坐标里分 9 块画，块边落在设备像素的小数位置上
// 各自抗锯齿，接缝处透出背景。改成 9 个子元素各画一块，下面的块往上面的块底下多伸 1 个设备像素（中间块在最下面，四条边
// 在中间，四个角在最上面），接缝处露出来的是图片本身相邻的像素，不是背景。伸出去的部分用 padding + background-origin:
// content-box 画：图片仍按原来的块对齐，多出来的是原图紧挨着的像素。
// 只在上面那块挨着接缝的像素完全不透明时才伸：半透明的地方叠两层会出现更深的线（比原来的浅线更显眼）。每张图解码后看一次
// 接缝两侧的透明度，按「图片 + 九宫格」记下来。一处都不能伸（整张半透明、读不了像素）就照旧用上游的 border-image。
// 九宫格平铺（tileGridIndice）的块要重复的是图片的一部分，单个背景层做不到，也照旧用 border-image。
import * as fgui from '../vendor/fairygui.module.js';
import {after, field} from './hook';

const PATCH = 12;
/** 伸多少：1 个设备像素，按元素自己的 CSS 像素算是 1 / (根节点缩放 × devicePixelRatio)。放在根元素的 CSS 变量里，
 * 缩放变了只改这一个值（setNineSliceOverlap），不用逐个重算。 */
const OVERLAP = 'var(--lgui-nine-overlap, 1px)';

/** 根节点缩放（或 devicePixelRatio）变了以后调用：deviceScale 是设计尺寸 1 像素对应几个设备像素。 */
export function setNineSliceOverlap(deviceScale: number): void {
  document.documentElement.style.setProperty('--lgui-nine-overlap', `${deviceScale > 0 ? 1 / deviceScale : 1}px`);
}

type Margin = {left: number; top: number; right: number; bottom: number};
type NineImage = HTMLElement & {_src?: string; _scale9Grid?: Margin; _scaleByTile?: boolean; _tileGridIndice: number; _textureScale: {x: number; y: number}; _timerID_1: number; refresh(): void};
export const nineSliceFields = ['_tileGridIndice', '_textureScale', '_timerID_1'] as const;

type Sides = {left: boolean; right: boolean; top: boolean; bottom: boolean};
/** 一张图按某个九宫格切好以后：原图尺寸，每一块往哪几边伸。'border-image' 表示一处都不能伸，照旧。 */
type Plan = {width: number; height: number; grow: Record<string, Sides>} | 'border-image';
const plans = new Map<string, Plan | Promise<void>>();
const pieces = new WeakMap<HTMLElement, HTMLElement[]>();
const pending = new WeakMap<HTMLElement, number>();

const keyOf = (src: string, grid: Margin): string => `${src}|${grid.left},${grid.top},${grid.right},${grid.bottom}`;
const isNine = (image: NineImage): boolean => !!image._scale9Grid && !!image._src && !image._scaleByTile && (image._tileGridIndice & 0xf) === 0;
// 下面的块在上，按画的先后：中间、四条边、四个角
const ORDER = [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]];

async function analyze(src: string, grid: Margin): Promise<Plan> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const w = image.naturalWidth, h = image.naturalHeight;
  let alpha: Uint8ClampedArray | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context?.drawImage(image, 0, 0);
    alpha = context ? context.getImageData(0, 0, w, h).data : null;
  } catch {
    alpha = null; // 跨域图片读不了像素：不伸，照旧用 border-image
  }
  // 原图里 [x0, x1) × [y0, y1) 全部不透明吗
  const opaque = (x0: number, x1: number, y0: number, y1: number): boolean => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    if (!alpha || x1 <= x0 || y1 <= y0) return false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alpha[(y * w + x) * 4 + 3] !== 255) return false;
    return true;
  };
  const L = grid.left, R = w - grid.right, T = grid.top, B = h - grid.bottom;
  // 下面那块的某一边伸到上面那块底下：看上面那块挨着接缝的 2 列（行）像素
  const none = {left: false, right: false, top: false, bottom: false};
  const grow: Record<string, Sides> = {
    '11': {left: opaque(L - 2, L, T, B), right: opaque(R, R + 2, T, B), top: opaque(L, R, T - 2, T), bottom: opaque(L, R, B, B + 2)},
    '10': {...none, left: opaque(L - 2, L, 0, T), right: opaque(R, R + 2, 0, T)},
    '12': {...none, left: opaque(L - 2, L, B, h), right: opaque(R, R + 2, B, h)},
    '01': {...none, top: opaque(0, L, T - 2, T), bottom: opaque(0, L, B, B + 2)},
    '21': {...none, top: opaque(R, w, T - 2, T), bottom: opaque(R, w, B, B + 2)}
  };
  const any = Object.values(grow).some(s => s.left || s.right || s.top || s.bottom);
  return any ? {width: w, height: h, grow} : 'border-image';
}

function planOf(image: NineImage): Plan | null {
  const src = image._src as string, grid = image._scale9Grid as Margin;
  const key = keyOf(src, grid);
  const known = plans.get(key);
  if (known && !(known instanceof Promise)) return known;
  if (!known) {
    // 解码失败：交还上游（照旧 border-image），不再重试
    plans.set(key, analyze(src, grid).then(plan => { plans.set(key, plan); }, () => { plans.set(key, 'border-image'); }));
  }
  // 看完再画
  void (plans.get(key) as Promise<void>).then(() => { if (image._src === src) image.refresh(); });
  return null;
}

function clear(image: HTMLElement): void {
  for (const piece of pieces.get(image) ?? []) piece.remove();
  pieces.delete(image);
  const cls = applied.get(image);
  if (cls) { image.classList.remove(cls); applied.delete(image); }
}

// 每种「图片 + 九宫格 + 贴图缩放」生成一组样式规则（位置、伸出、背景定位都是相对尺寸，和控件多大无关），
// 每个九宫格只加一个类名和 9 个空的 <i>：几百个九宫格时比逐个写行内样式快得多。
let sheet: CSSStyleSheet | null = null;
const classes = new Map<string, string>();
const applied = new WeakMap<HTMLElement, string>();

function classFor(image: NineImage, plan: Exclude<Plan, 'border-image'>): string {
  const grid = image._scale9Grid as Margin, scale = image._textureScale, src = image._src as string;
  const key = `${keyOf(src, grid)}|${scale.x},${scale.y}`;
  const known = classes.get(key);
  if (known) return known;
  if (!sheet) {
    const style = document.createElement('style');
    style.id = 'lgui-nine-slice';
    document.head.appendChild(style);
    sheet = style.sheet as CSSStyleSheet; // 已经插进文档，一定有
  }
  const cls = `lgui-nine-${classes.size}`;
  // 元素里四边的宽度（同上游 border-image-width）
  const border = {left: grid.left / scale.x, top: grid.top / scale.y, right: grid.right / scale.x, bottom: grid.bottom / scale.y};
  const cols = [[0, grid.left], [grid.left, plan.width - grid.right], [plan.width - grid.right, plan.width]];
  const rows = [[0, grid.top], [grid.top, plan.height - grid.bottom], [plan.height - grid.bottom, plan.height]];
  sheet.insertRule(`.${cls} > i { position: absolute; box-sizing: border-box; pointer-events: none; background-image: url("${src.replace(/["\\]/g, '\\$&')}"); background-repeat: no-repeat; background-origin: content-box; }`, sheet.cssRules.length);
  for (const [col, row] of ORDER) {
    const id = `${col}${row}`;
    const [sx0, sx1] = cols[col], [sy0, sy1] = rows[row];
    const sw = sx1 - sx0, sh = sy1 - sy0;
    if (sw <= 0 || sh <= 0) { sheet.insertRule(`.${cls} > i[data-lgui-nine="${id}"] { display: none; }`, sheet.cssRules.length); continue; }
    // 位置：左列贴左边、宽 border.left；中列在两边之间拉伸；右列贴右边。行同理。
    const left = ['0px', `${border.left}px`, `(100% - ${border.right}px)`][col];
    const right = [`(100% - ${border.left}px)`, `${border.right}px`, '0px'][col];
    const top = ['0px', `${border.top}px`, `(100% - ${border.bottom}px)`][row];
    const bottom = [`(100% - ${border.top}px)`, `${border.bottom}px`, '0px'][row];
    const grow = plan.grow[id] ?? {left: false, right: false, top: false, bottom: false};
    const by = (side: boolean): string => side ? OVERLAP : '0px';
    // 整张图缩放到「这一块的原图范围正好等于内容区」，再挪到这一块的位置（百分比相对内容区）
    const size = `${(plan.width / sw) * 100}% ${(plan.height / sh) * 100}%`;
    const position = `${plan.width === sw ? 0 : (sx0 / (plan.width - sw)) * 100}% ${plan.height === sh ? 0 : (sy0 / (plan.height - sh)) * 100}%`;
    sheet.insertRule(`.${cls} > i[data-lgui-nine="${id}"] { left: calc(${left} - ${by(grow.left)}); right: calc(${right} - ${by(grow.right)}); top: calc(${top} - ${by(grow.top)}); bottom: calc(${bottom} - ${by(grow.bottom)}); padding: ${by(grow.top)} ${by(grow.right)} ${by(grow.bottom)} ${by(grow.left)}; background-size: ${size}; background-position: ${position}; }`, sheet.cssRules.length);
  }
  classes.set(key, cls);
  return cls;
}

function render(image: NineImage): void {
  if (!isNine(image)) { clear(image); return; }
  const plan = planOf(image);
  if (!plan || plan === 'border-image') return;
  const cls = classFor(image, plan);
  const old = applied.get(image);
  if (old !== cls) {
    if (old) image.classList.remove(old);
    image.classList.add(cls);
    applied.set(image, cls);
  }
  if (!pieces.has(image)) {
    const list = ORDER.map(([col, row]) => { const piece = document.createElement('i'); piece.dataset.lguiNine = `${col}${row}`; return piece; });
    image.append(...list);
    pieces.set(image, list);
  }
  image.style.borderImage = '';
  image.style.backgroundImage = 'none';
}

export function installNineSlice(): void {
  after<NineImage>(PATCH, fgui.Image.prototype, 'Image', 'refresh', image => {
    if (!isNine(image)) { if (pieces.has(image)) clear(image); return; }
    const plan = plans.get(keyOf(image._src as string, image._scale9Grid as Margin));
    if (plan === 'border-image') { clear(image); return; } // 照旧：上游下一帧画 border-image
    // 上游在下一帧把它画成 border-image；改由我们在下一帧画 9 块
    const timer = field<number>(image, '_timerID_1');
    if (timer) { cancelAnimationFrame(timer); Reflect.set(image, '_timerID_1', 0); }
    if (pending.has(image)) return;
    pending.set(image, requestAnimationFrame(() => { pending.delete(image); render(image); }));
  });
}
