// 补丁 1：图片 fill。上游 Image 的 fillMethod、fillOrigin、fillClockwise、fillAmount 是空实现（进度条、长按进度显示不出来）。
// 存下这 4 个值，变化时刷新裁剪：水平、垂直用 CSS clip-path: inset(…)；径向 90/180/360 度用 conic-gradient 做 mask-image。
import * as fgui from '../vendor/fairygui.module.js';
import {accessor} from './hook';

const PATCH = 1;

type FillState = {method: number; origin: number; clockwise: boolean; amount: number};
const states = new WeakMap<HTMLElement, FillState>();
const stateOf = (image: HTMLElement): FillState => {
  let state = states.get(image);
  if (!state) { state = {method: fgui.FillMethod.None, origin: 0, clockwise: true, amount: 1}; states.set(image, state); }
  return state;
};

function updateFill(image: HTMLElement): void {
  const {method, origin, clockwise, amount} = stateOf(image);
  const a = Math.min(1, Math.max(0, amount));
  const hidden = ((1 - a) * 100) + '%';
  image.style.clipPath = '';
  image.style.maskImage = image.style.webkitMaskImage = '';
  if (method === fgui.FillMethod.None) return;
  if (method === fgui.FillMethod.Horizontal) {
    // 0 从左边开始填，1 从右边开始填
    image.style.clipPath = origin === 1 ? `inset(0 0 0 ${hidden})` : `inset(0 ${hidden} 0 0)`;
    return;
  }
  if (method === fgui.FillMethod.Vertical) {
    // 0 从上边开始填，1 从下边开始填
    image.style.clipPath = origin === 1 ? `inset(${hidden} 0 0 0)` : `inset(0 0 ${hidden} 0)`;
    return;
  }
  // 径向：圆心、顺时针方向的起始角（0 度朝上）、总角度
  let center: string, start: number, span: number;
  if (method === fgui.FillMethod.Radial90) {
    span = 90;
    [center, start] = ([['0% 0%', 90], ['100% 0%', 180], ['0% 100%', 0], ['100% 100%', 270]] as const)[origin] ?? ['0% 0%', 90];
  } else if (method === fgui.FillMethod.Radial180) {
    span = 180;
    [center, start] = ([['50% 0%', 90], ['50% 100%', 270], ['0% 50%', 0], ['100% 50%', 180]] as const)[origin] ?? ['50% 0%', 90];
  } else {
    span = 360;
    center = '50% 50%';
    start = [0, 180, 270, 90][origin] ?? 0;
  }
  const filled = a * span;
  image.style.maskImage = image.style.webkitMaskImage = clockwise
    ? `conic-gradient(from ${start}deg at ${center}, #000 0deg ${filled}deg, transparent ${filled}deg 360deg)`
    : `conic-gradient(from ${start}deg at ${center}, transparent 0deg ${span - filled}deg, #000 ${span - filled}deg ${span}deg, transparent ${span}deg 360deg)`;
}

export function installImageFill(): void {
  const proto = fgui.Image.prototype;
  const prop = <K extends keyof FillState>(name: string, key: K, cast: (value: unknown) => FillState[K]): void => accessor<HTMLElement>(PATCH, proto, 'Image', name, {
    get: image => stateOf(image)[key],
    set: (image, value) => {
      const state = stateOf(image);
      const next = cast(value);
      if (state[key] === next) return;
      state[key] = next;
      updateFill(image);
    }
  });
  prop('fillMethod', 'method', Number);
  prop('fillOrigin', 'origin', Number);
  prop('fillClockwise', 'clockwise', value => value !== false);
  prop('fillAmount', 'amount', Number);
}
