// FairyGUI-dom 补丁的入口：H5 后端启动时调用一次 installFairyGuiPatches()。
// 上游文件（../vendor/fairygui.module.js）不手改；能挂钩子的补丁在这里装（先调上游原方法，再补），
// 挂不上的写成同目录的 .patch，由仓库的 scripts/fairygui-dom/build.mjs 打进生成文件。台账见 ../vendor/PATCHES.md。
// 装的时候检查要挂的方法、属性、字段还在不在：不在就报 LGUI-RT-230，写清上游哪里改了、哪个补丁要重看。
import * as fgui from '../vendor/fairygui.module.js';
import {assigned, fields, once} from './hook';
import {installImageFill} from './image-fill';
import {installImageManifest} from './image-manifest';
import {installTextShadow, installTextStroke, textFields} from './text-format';
import {installTextShrink, shrinkAssigned, shrinkFields} from './text-shrink';
import {installButtonPress, buttonFields} from './button-press';
import {installTransitionStage, transitionAssigned} from './transition-stage';
import {installNineSlice, nineSliceAssigned, nineSliceFields} from './nine-slice';
import {installCodeIcons, loaderFields} from './code-icon';
import {installTouchableOpaque, touchableOpaqueAssigned, touchableOpaqueFields} from './touchable-opaque';

/** 装上全部钩子（装过就不再装）。要在创建任何 FairyGUI 对象之前调用。
 * 装不上时报 LGUI-RT-230 / 231；之后再调用原样再报，不会把已经装上的钩子再包一层。 */
export const installFairyGuiPatches: () => void = once(() => {
  checkFields(); // 先查再装：有的检查看上游 setter 的写法，装上钩子以后那个 setter 就换成我们的了
  installImageFill();
  installImageManifest();
  installTextShadow();
  installTextStroke();
  installTextShrink();
  installButtonPress();
  installTransitionStage();
  installNineSlice();
  installCodeIcons();
  installTouchableOpaque();
});

// 钩子里读的上游字段：构造函数里设的，各建一个对象查一遍；不在构造函数里设的，查上游设它的地方还在不在。
function checkFields(): void {
  fields(2, new fgui.UIPackage(), 'UIPackage', ['_items']);
  const comp = new fgui.GComponent();
  fields(14, comp.element, 'UIElement', touchableOpaqueFields);
  comp.dispose();
  const text = new fgui.GTextField();
  fields(4, text.element, 'TextField', textFields);
  fields(8, text.element, 'TextField', shrinkFields);
  fields(4, Reflect.get(text.element, '_textFormat') as object, 'TextFormat', ['shadowOffset', 'shadowColor', 'outline', 'outlineColor', 'size', 'lineSpacing']);
  text.dispose();
  const image = new fgui.GImage();
  fields(12, image.element, 'Image', nineSliceFields);
  image.dispose();
  const button = new fgui.GButton();
  fields(9, button, 'GButton', buttonFields);
  button.dispose();
  const loader = new fgui.GLoader();
  fields(13, loader, 'GLoader', loaderFields);
  loader.dispose();
  for (const [member, name] of nineSliceAssigned) assigned(12, fgui.Image.prototype, 'Image', member, name);
  for (const [member, name] of shrinkAssigned) assigned(8, fgui.TextField.prototype, 'TextField', member, name);
  for (const [member, name] of transitionAssigned) assigned(10, fgui.Transition.prototype, 'Transition', member, name);
  for (const [member, name] of touchableOpaqueAssigned) assigned(14, fgui.UIElement.prototype, 'UIElement', member, name);
}
