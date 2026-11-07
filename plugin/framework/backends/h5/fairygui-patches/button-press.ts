// 补丁 9：按钮 downEffect="scale" 的按压只是视觉效果，不改布局。
// 上游在 GButton.constructExtension 里把轴心改成 (0.5, 0.5)，按下时改 GObject 的 scale。轴心一变，按钮被关联拉宽
// （比如宽屏下跟兄弟控件一起变宽）时 FairyGUI 按轴心修正位置，按钮就往左跑；scale 还会被 GearSize 记进当前页、被
// 改 scale 的动效（呼吸）每帧盖掉。
// 改成：轴心保持 XML 里写的；按下时只设元素的 CSS scale 属性（和 FairyGUI 自己写的 transform 叠加），GObject 的
// 尺寸、位置、scale 都不变。按压由我们接管，上游的 _downEffect 置 0。
import * as fgui from '../vendor/fairygui.module.js';
import {after, around, field} from './hook';

const PATCH = 9;

type Button = fgui.GButton & {_downEffect: number; _downEffectValue: number; pivotX: number; pivotY: number; pivotAsAnchor: boolean; setPivot(x: number, y: number, asAnchor?: boolean): void};
export const buttonFields = ['_downEffect', '_downEffectValue'] as const;

/** 我们接管的按压缩放倍数。 */
const pressScale = new WeakMap<fgui.GButton, number>();
const pressedStates = new Set(['down', 'selectedOver', 'selectedDisabled']);

export function installButtonPress(): void {
  const proto = fgui.GButton.prototype;
  around<Button, {x: number; y: number; anchor: boolean}>(PATCH, proto, 'GButton', 'constructExtension',
    button => ({x: button.pivotX, y: button.pivotY, anchor: button.pivotAsAnchor}),
    (button, pivot) => {
      if (field<number>(button, '_downEffect') !== 2) return;
      pressScale.set(button, field<number>(button, '_downEffectValue'));
      Reflect.set(button, '_downEffect', 0);
      button.setPivot(pivot.x, pivot.y, pivot.anchor);
    });
  after<Button>(PATCH, proto, 'GButton', 'setState', (button, args) => {
    const scale = pressScale.get(button);
    if (scale === undefined) return;
    button.element.style.scale = pressedStates.has(String(args[0])) ? String(scale) : '';
  });
}
