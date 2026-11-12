// 补丁 14：opaque = false 容器（如舞台根、层容器、HUD 组件）在 touchable = false 时，子孙控件也必须禁点（pointer-events: none）。
// 上游 UIElement.updateTouchableFlag() 有两处遗漏：
// 1. 只检查自身的 _touchable / _opaque / _touchDisabled，不检查祖先是否 _touchable === false；当父容器 _opaque === false 时，子控件会被设成 pointer-events: auto，导致被弹窗压住的 HUD 按钮依然能被点中。
// 2. 当 _opaque === false 的容器切换 touchable 时，它自身的 style.pointerEvents 始终是 'none'（前后相等），上游不会向 _children 递归刷新。
import * as fgui from '../vendor/fairygui.module.js';
import {accessor, after, field} from './hook';

export const touchableOpaqueFields = ['parent', '_touchable', '_opaque', '_children'] as const;
export const touchableOpaqueAssigned: readonly (readonly [string, string])[] = [['setNotInteractable', '_touchDisabled']];

function hasUntouchableAncestor(el: fgui.UIElement): boolean {
  for (let p = el.parent; p; p = p.parent) {
    if (!field<boolean>(p, '_touchable') || field<boolean>(p, '_touchDisabled')) return true;
  }
  return false;
}

function disableSubtree(el: fgui.UIElement): void {
  el.style.pointerEvents = 'none';
  for (const child of field<readonly fgui.UIElement[]>(el, '_children')) {
    disableSubtree(child);
  }
}

function refreshSubtree(el: fgui.UIElement): void {
  const before = el.style.pointerEvents;
  const update = Reflect.get(el, 'updateTouchableFlag') as () => void;
  update.call(el);
  // 若子元素自身仍是 pointer-events: none（如嵌套的 opaque=false 容器恢复可点），上游因值未变不会继续向下递归，这里继续往下刷。
  if (el.style.pointerEvents === before && !hasUntouchableAncestor(el)) {
    for (const child of field<readonly fgui.UIElement[]>(el, '_children')) {
      refreshSubtree(child);
    }
  }
}

export function installTouchableOpaque(): void {
  after<fgui.UIElement>(14, fgui.UIElement.prototype, 'UIElement', 'updateTouchableFlag', self => {
    if (hasUntouchableAncestor(self)) disableSubtree(self);
  });

  accessor<fgui.UIElement>(14, fgui.UIElement.prototype, 'UIElement', 'touchable', {
    set(self) {
      if (field<boolean>(self, '_opaque')) return;
      if (!field<boolean>(self, '_touchable') || field<boolean>(self, '_touchDisabled') || hasUntouchableAncestor(self)) {
        disableSubtree(self);
        return;
      }
      for (const child of field<readonly fgui.UIElement[]>(self, '_children')) {
        refreshSubtree(child);
      }
    }
  });
}
