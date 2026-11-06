// 补丁 4 和 7：文字格式（TextField.applyFormat 之后补）。
// 4 阴影：上游读进了 shadowColor、shadowOffset，但从来不用。偏移不为 0 时设置 text-shadow。
// 7 描边在字外：上游用 -webkit-text-stroke 画描边，描边骑在字形边缘、一半压进笔画，粗描边把笔画吃空。
//   加 paint-order: stroke fill（先画描边再画字），描边宽度用 2 × outline：露在字外的正好是 outline，和 Unity 端
//   （把字形往四周各偏移 outline 再画一遍）一致。
import * as fgui from '../vendor/fairygui.module.js';
import {after, field} from './hook';

export type TextFormat = {
  size: number; font: string | null; lineSpacing: number; letterSpacing: number; bold?: boolean; italic?: boolean;
  align?: string; verticalAlign?: string; outline: number; outlineColor: number; shadowOffset: {x: number; y: number}; shadowColor: number;
};

/** TextField 元素（fgui-text）上补丁用到的字段。 */
export type TextElement = HTMLElement & {_span: HTMLSpanElement; _textFormat: TextFormat};

export const textFields = ['_span', '_textFormat'] as const;

export function installTextShadow(): void {
  after<TextElement>(4, fgui.TextField.prototype, 'TextField', 'applyFormat', text => {
    const span = field<HTMLSpanElement>(text, '_span');
    const format = field<TextFormat>(text, '_textFormat');
    if (format.shadowOffset.x !== 0 || format.shadowOffset.y !== 0) span.style.textShadow = `${format.shadowOffset.x}px ${format.shadowOffset.y}px 0 ${fgui.convertToHtmlColor(format.shadowColor)}`;
    else if (span.style.textShadow) span.style.textShadow = '';
  });
}

export function installTextStroke(): void {
  after<TextElement>(7, fgui.TextField.prototype, 'TextField', 'applyFormat', text => {
    const span = field<HTMLSpanElement>(text, '_span');
    const format = field<TextFormat>(text, '_textFormat');
    if (format.outline > 0) {
      span.style.webkitTextStroke = `${format.outline * 2}px ${fgui.convertToHtmlColor(format.outlineColor)}`;
      span.style.paintOrder = 'stroke fill';
    } else if (span.style.paintOrder) span.style.paintOrder = '';
  });
}
