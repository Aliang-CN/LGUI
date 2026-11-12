// 代码图标注册表（icon://<名字>）：供 MVC、H5、headless 和 Unity 后端共用，不含 DOM 依赖。
import type {IconCanvas, IconDef, IconShape} from './ui';
import {LgRuntimeError} from './errors';

const ICON_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const ICON_URL = /^icon:\/\/([A-Za-z0-9][A-Za-z0-9._/-]*)$/;

export interface ShapesIcon {
  readonly kind: 'shapes';
  readonly width: number;
  readonly height: number;
  readonly viewBox: readonly [number, number, number, number];
  readonly shapes: readonly IconShape[];
  cachedSvgUrl?: string;
}

export interface DrawIcon {
  readonly kind: 'draw';
  readonly width: number;
  readonly height: number;
  readonly draw: (g: IconCanvas, width: number, height: number) => void;
  /** 按 DPR 缓存生成的 PNG data URL。 */
  readonly cachedPngUrls: Map<number, string>;
}

export type RegisteredIcon = ShapesIcon | DrawIcon;

const registeredIcons = new Map<string, RegisteredIcon>();
const appIcons = new Map<string, RegisteredIcon>();

let faultReporter: ((error: LgRuntimeError, data?: object) => void) | null = null;

/** 内部用：MVC 启动时把 fault 接进来（正式构建里只记 error 日志、不抛错；未接入时直接抛）。 */
export function setIconFaultReporter(fn: ((error: LgRuntimeError, data?: object) => void) | null): void {
  faultReporter = fn;
}

/** 报告代码图标错误（LGUI-RT-072）。 */
export function reportIconFault(error: LgRuntimeError, data: object = {}): void {
  if (faultReporter) { faultReporter(error, data); return; }
  throw error;
}

const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

function parseIconDef(name: string, def: IconDef): RegisteredIcon {
  if (!ICON_NAME.test(name)) {
    if (name.startsWith('icon://')) {
      const bare = name.slice(7) || 'play';
      throw new LgRuntimeError('LGUI-RT-072', `注册代码图标时名字「${name}」带了 icon:// 前缀。`, `注册时只写名字（比如 '${bare}'），用的时候地址写 'icon://${bare}'。`);
    }
    throw new LgRuntimeError('LGUI-RT-072', `代码图标名「${name}」不合规范：要以字母或数字开头，只能用字母、数字和 . _ / -。`, "改成比如 'play'、'hud/sword'。");
  }
  if (!def || typeof def !== 'object') {
    throw new LgRuntimeError('LGUI-RT-072', `代码图标「${name}」的定义不是对象。`, '写成 { shapes: [...] } 或 { width, height, draw(g, w, h) { ... } }。');
  }
  if ('draw' in def && typeof def.draw === 'function') {
    if (!isPositive(def.width) || !isPositive(def.height)) {
      throw new LgRuntimeError('LGUI-RT-072', `代码图标「${name}」的 width、height 必须是正数（当前 ${String(def.width)}×${String(def.height)}）。`, '写正数像素尺寸，比如 width: 64, height: 64。');
    }
    return {kind: 'draw', width: def.width, height: def.height, draw: def.draw, cachedPngUrls: new Map()};
  }
  if ('shapes' in def && Array.isArray(def.shapes) && def.shapes.length > 0) {
    const vb = def.viewBox;
    if (vb !== undefined && (!Array.isArray(vb) || vb.length !== 4 || !vb.every(n => typeof n === 'number' && Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0)) {
      throw new LgRuntimeError('LGUI-RT-072', `代码图标「${name}」的 viewBox 不对：应该是 [minX, minY, width, height]，宽高为正数。`, '写成比如 viewBox: [0, 0, 24, 24]。');
    }
    const width = def.width ?? (vb ? vb[2] : 64);
    const height = def.height ?? (vb ? vb[3] : 64);
    if (!isPositive(width) || !isPositive(height)) {
      throw new LgRuntimeError('LGUI-RT-072', `代码图标「${name}」的 width、height 必须是正数（当前 ${String(width)}×${String(height)}）。`, '写正数像素尺寸，比如 width: 64, height: 64。');
    }
    for (const shape of def.shapes) {
      if (!shape || typeof shape !== 'object' || !['path', 'circle', 'rect', 'polygon', 'line'].includes(shape.type)) {
        throw new LgRuntimeError('LGUI-RT-072', `代码图标「${name}」里有不认识的图元类型 ${String((shape as {type?: unknown})?.type)}。`, '图元 type 只能是 path、circle、rect、polygon、line。');
      }
    }
    return {kind: 'shapes', width, height, viewBox: vb ?? [0, 0, width, height], shapes: def.shapes};
  }
  throw new LgRuntimeError('LGUI-RT-072', `代码图标「${name}」缺少非空的 shapes 数组或 draw 函数。`, '写成 { shapes: [...] } 或 { width: 64, height: 64, draw(g, w, h) { ... } }。');
}

/** 注册一组代码图标（lgui.registerIcons 用）；同名覆盖。 */
export function registerIcons(icons: Record<string, IconDef>): void {
  for (const [name, def] of Object.entries(icons)) registeredIcons.set(name, parseIconDef(name, def));
}

/** 内部用：启动 app 时设置 app.icons（每次 boot 重置上一份 app.icons，测试之间互不串）。 */
export function setAppIcons(icons: Record<string, IconDef> | undefined): void {
  appIcons.clear();
  if (!icons) return;
  for (const [name, def] of Object.entries(icons)) appIcons.set(name, parseIconDef(name, def));
}

/** 内部用：测试之间清空全部代码图标。 */
export function clearIcons(): void {
  registeredIcons.clear();
  appIcons.clear();
}

/** 有没有注册过任何代码图标。 */
export function hasRegisteredIcons(): boolean {
  return registeredIcons.size > 0 || appIcons.size > 0;
}

/** 是不是 icon:// 地址。 */
export function isIconUrl(url: string): boolean {
  return url.startsWith('icon://');
}

/** 按 icon://<名字> 取出图标定义；未注册或写法不对返回 null。 */
export function lookupIcon(url: string): RegisteredIcon | null {
  const m = ICON_URL.exec(url);
  if (!m) return null;
  return appIcons.get(m[1]) ?? registeredIcons.get(m[1]) ?? null;
}

/** icon://<名字> 是否已注册。 */
export function hasIcon(url: string): boolean {
  return lookupIcon(url) !== null;
}

/** 代码图标的设计尺寸；未注册返回 null。 */
export function iconSize(url: string): {width: number; height: number} | null {
  const found = lookupIcon(url);
  return found ? {width: found.width, height: found.height} : null;
}

/** 未注册或写法不对时的报错（LGUI-RT-072）。 */
export function missingIconError(url: string, where?: string): LgRuntimeError {
  const prefix = where ? `${where} 的` : '';
  if (!ICON_URL.test(url)) {
    return new LgRuntimeError('LGUI-RT-072', `${prefix}代码图标地址「${url}」写法不对。`, "写成 icon://<名字>，比如 'icon://play'。");
  }
  const name = url.slice(7);
  return new LgRuntimeError('LGUI-RT-072', `${prefix}代码图标 ${url} 没有注册，显示不出来。`, `在 src/main.ts 的 lgui.app({ icons }) 里注册 '${name}'，或者先调用 lgui.registerIcons({ ${name}: ... })。`);
}

/** Unity 后端遇到代码图标时的报错（LGUI-RT-072）。 */
export function unityIconError(url?: string): LgRuntimeError {
  return new LgRuntimeError('LGUI-RT-072', url ? `Unity 后端不支持代码图标（${url}）。` : 'Unity 后端不支持代码图标（icons / lgui.registerIcons）。', '导出到 Unity 的工程请改用登记在 package.xml 里的图片（ui://包名/图片名）。');
}

const escAttr = (v: string | number): string => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (name: string, value: string | number | undefined): string => value === undefined ? '' : ` ${name}="${escAttr(value)}"`;

function renderShape(shape: IconShape): string {
  const common = (s: {fill?: string; stroke?: string; strokeWidth?: number; opacity?: number}): string =>
    attr('fill', s.fill ?? 'none') + attr('stroke', s.stroke) + attr('stroke-width', s.strokeWidth) + attr('opacity', s.opacity);
  switch (shape.type) {
    case 'path':
      return `<path${attr('d', shape.d)}${common(shape)}${attr('stroke-linecap', shape.strokeLinecap)}${attr('stroke-linejoin', shape.strokeLinejoin)}/>`;
    case 'circle':
      return `<circle${attr('cx', shape.cx)}${attr('cy', shape.cy)}${attr('r', shape.r)}${common(shape)}/>`;
    case 'rect':
      return `<rect${attr('x', shape.x)}${attr('y', shape.y)}${attr('width', shape.width)}${attr('height', shape.height)}${attr('rx', shape.rx)}${common(shape)}/>`;
    case 'polygon': {
      const pts = typeof shape.points === 'string' ? shape.points : shape.points.map(p => `${p[0]},${p[1]}`).join(' ');
      return `<polygon${attr('points', pts)}${common(shape)}${attr('stroke-linejoin', shape.strokeLinejoin)}/>`;
    }
    case 'line':
      return `<line${attr('x1', shape.x1)}${attr('y1', shape.y1)}${attr('x2', shape.x2)}${attr('y2', shape.y2)} fill="none"${attr('stroke', shape.stroke)}${attr('stroke-width', shape.strokeWidth)}${attr('stroke-linecap', shape.strokeLinecap)}${attr('opacity', shape.opacity)}/>`;
  }
}

/** 把矢量代码图标序列化成可在 CSS url('...') 里直接使用的 SVG data URL（按实例缓存）。 */
export function iconSvgDataUrl(icon: ShapesIcon): string {
  if (icon.cachedSvgUrl) return icon.cachedSvgUrl;
  const vb = icon.viewBox.join(' ');
  const body = icon.shapes.map(renderShape).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${escAttr(icon.width)}" height="${escAttr(icon.height)}" viewBox="${escAttr(vb)}">${body}</svg>`;
  // FairyGUI-dom 写成 url('...')，所以单引号也要编码成 %27。
  icon.cachedSvgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/'/g, '%27')}`;
  return icon.cachedSvgUrl;
}
