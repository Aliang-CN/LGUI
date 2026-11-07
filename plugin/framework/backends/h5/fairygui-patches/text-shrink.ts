// 补丁 8：autoSize="shrink"（文字超长时缩小字号塞进框里）。上游只把 overflow 设成 hidden，超出的部分被裁掉。
// 按 Unity 端（TextField.DoShrink）的规则缩：不换行的文字按宽度缩，有多行且高度超出时按高度缩；只缩不放大。
//
// 三种尺寸分开算：
// - 控件框：控件的宽高，减去 .fgui-text 四周 2 像素的内边距（和 Unity 的 GUTTER 一样）就是能放字的地方。
// - 字体行框：每行占 (字号 + 行距) 高，多行文字按它算高度、算垂直对齐。
// - 实际字面：字形真正画出来的范围（Canvas measureText 的 actualBoundingBox，比步进宽时取它），再加上两边各 outline 的描边（补丁 7）。
//   宽度按实际字面算，缩完以后字和描边都在框里；所以缩放的文字不用再裁，overflow 改成 visible。
//
// 什么时候测：只在文字、控件尺寸、字体格式、autoSize、singleLine 变化时（挂在上游对应的方法后面），不每帧测。
// 怎么测：不换行的纯文字用 Canvas measureText，不读 DOM 布局，不会和别的写入交替触发强制重排；只改尺寸时用上次的结果。
// 会自动换行的（没勾 singleLine）或带 UBB 的，折行只能交给浏览器：在页面外一个单独的测量元素上按整数字号二分（和 Unity 一样），
// 每次只重排这一个元素。
import * as fgui from '../vendor/fairygui.module.js';
import {LgRuntimeError} from '../../../core/index';
import {accessor, after, field} from './hook';
import type {TextElement, TextFormat} from './text-format';

const PATCH = 8;
const GUTTER = 2;

type ShrinkText = TextElement & {_text: string; _html?: boolean; _autoSize: number; _singleLine?: boolean; _contentRect: {width: number; height: number}; applyFormat(): void};
export const shrinkFields = ['_text', '_autoSize', '_contentRect'] as const;
/** 不在构造函数里设的字段：[上游设它的访问器, 字段]。_html 由 text（false）和 htmlText（true）设。 */
export const shrinkAssigned = [['singleLine', '_singleLine'], ['text', '_html'], ['htmlText', '_html']] as const;

/** 不换行文字的测量结果（字号是原字号）。 */
type Natural = {key: string; width: number; lines: number};
const naturals = new WeakMap<HTMLElement, Natural>();
/** 现在缩到了原字号的几倍（1 = 没缩）。 */
const scales = new WeakMap<HTMLElement, number>();

let context: CanvasRenderingContext2D | null = null;
let inheritedFamily: string | null = null;
let measurer: HTMLSpanElement | null = null;

function family(format: TextFormat): string {
  if (format.font) return format.font;
  if (fgui.UIConfig.defaultFont) return fgui.UIConfig.defaultFont;
  inheritedFamily ??= getComputedStyle(document.body).fontFamily;
  return inheritedFamily;
}

function fontOf(format: TextFormat, size: number): string {
  return `${format.italic ? 'italic ' : ''}${format.bold ? 'bold ' : ''}${size}px ${family(format)}`;
}

/** 不换行的纯文字：原字号下最宽一行的实际字面宽度和行数。 */
function natural(text: ShrinkText, format: TextFormat): Natural {
  const font = fontOf(format, format.size);
  const key = `${font}\n${text._text}`;
  const cached = naturals.get(text);
  if (cached?.key === key) return cached;
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) throw new LgRuntimeError('LGUI-RT-232', '浏览器给不出 Canvas 2D，量不了 autoSize="shrink" 文字的宽度。', '换一个支持 Canvas 2D 的浏览器（或 WebView）。');
  context.font = font;
  const lines = text._text.split('\n');
  let width = 0;
  for (const line of lines) {
    const m = context.measureText(line);
    width = Math.max(width, m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  }
  const result = {key, width, lines: lines.length};
  naturals.set(text, result);
  return result;
}

/** 会换行或带 UBB 的文字：在页面外的测量元素上排一次，返回内容的宽高（含内边距）。 */
function layout(text: ShrinkText, format: TextFormat, size: number): {width: number; height: number} {
  if (!measurer) {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:10000px;visibility:hidden;pointer-events:none';
    measurer = document.createElement('span');
    measurer.className = 'fgui-text';
    box.appendChild(measurer);
    document.body.appendChild(box);
  }
  const span = field<HTMLSpanElement>(text, '_span');
  measurer.style.cssText = span.style.cssText;
  measurer.style.fontFamily = family(format);
  measurer.style.fontSize = `${size}px`;
  measurer.style.lineHeight = `${size + format.lineSpacing}px`;
  // 不靠舞台的样式表（创建组件时 GRoot 可能还没建，.fgui-text 的规则还不在）
  measurer.style.position = 'absolute';
  measurer.style.display = 'block';
  measurer.style.boxSizing = 'border-box';
  measurer.style.padding = `${GUTTER}px`;
  measurer.style.top = '0px';
  measurer.style.height = '';
  measurer.style.overflow = 'visible';
  if (text._html) measurer.innerHTML = span.innerHTML;
  else measurer.textContent = text._text;
  return {width: measurer.scrollWidth, height: measurer.scrollHeight};
}

/** 算出缩放倍数，并给出缩完以后文字的高度（含内边距，垂直对齐用）。 */
function fit(text: ShrinkText, format: TextFormat): {scale: number; height: number} {
  const boxWidth = text._contentRect.width, boxHeight = text._contentRect.height;
  const stroke = format.outline > 0 ? format.outline * 2 : 0;
  const lineBox = format.size + format.lineSpacing;
  if (text._singleLine && !text._html) {
    const {width, lines} = natural(text, format);
    let scale = 1;
    if (width + stroke > boxWidth - GUTTER * 2) scale = (boxWidth - GUTTER * 2 - stroke) / width;
    if (lines > 1 && lines * lineBox > boxHeight - GUTTER * 2) scale = Math.min(scale, (boxHeight - GUTTER * 2) / (lines * lineBox));
    scale = Math.min(1, Math.max(scale, 1 / format.size));
    return {scale, height: lines * lineBox * scale + GUTTER * 2};
  }
  // 会换行或带 UBB：先按原字号排一次，放得下就不缩；放不下就按整数字号二分，找放得下的最大字号。单行的只看宽度（同 Unity）。
  const fits = (box: {width: number; height: number}): boolean => box.width <= boxWidth && (text._singleLine === true || box.height <= boxHeight);
  let box = layout(text, format, format.size);
  if (fits(box)) return {scale: 1, height: box.height};
  let low = 1, high = format.size - 1, best: {size: number; box: typeof box} | null = null;
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const candidate = layout(text, format, size);
    if (fits(candidate)) { best = {size, box: candidate}; low = size + 1; } else high = size - 1;
  }
  if (!best) { const size = 1; best = {size, box: layout(text, format, size)}; }
  box = best.box;
  return {scale: best.size / format.size, height: box.height};
}

function apply(text: ShrinkText): void {
  const span = field<HTMLSpanElement>(text, '_span');
  const format = field<TextFormat>(text, '_textFormat');
  if (text._autoSize !== fgui.AutoSizeType.Shrink) {
    // 不再是 shrink：上游的 autoSize setter 已经设好了 overflow；字号由上游的 applyFormat 写回原值。
    if (scales.has(text)) { scales.delete(text); naturals.delete(text); text.applyFormat(); }
    return;
  }
  if (!format.size) return;
  const {scale, height} = text._text ? fit(text, format) : {scale: 1, height: format.size + format.lineSpacing + GUTTER * 2};
  scales.set(text, scale);
  // 垂直对齐：上游按改字号之前量的高度算的，这里按缩完以后的高度重算（规则同上游 applyText）。
  const boxHeight = text._contentRect.height;
  const top = format.verticalAlign === 'top' ? 0 : format.verticalAlign === 'middle' ? Math.max(0, Math.floor((boxHeight - height) * 0.5)) : Math.max(0, boxHeight - height);
  // 值没变就不写：少让浏览器重新算样式
  write(span, 'overflow', 'visible');
  write(span, 'fontSize', `${format.size * scale}px`);
  write(span, 'lineHeight', `${(format.size + format.lineSpacing) * scale}px`);
  write(span, 'top', `${top}px`);
}

function write(span: HTMLSpanElement, name: 'overflow' | 'fontSize' | 'lineHeight' | 'top', value: string): void {
  if (span.style[name] !== value) span.style[name] = value;
}

export function installTextShrink(): void {
  const proto = fgui.TextField.prototype;
  // 文字变了（上游 applyText 只在文字真的变了时调用）、格式变了、控件尺寸变了。
  for (const name of ['applyText', 'applyFormat', 'onSizeChanged']) after<ShrinkText>(PATCH, proto, 'TextField', name, apply);
  for (const name of ['autoSize', 'singleLine']) accessor<ShrinkText>(PATCH, proto, 'TextField', name, {set: apply});
}

/** 文字现在缩到了原字号的几倍（测试和调试用；没缩是 1）。 */
export function shrinkScale(element: HTMLElement): number { return scales.get(element) ?? 1; }
