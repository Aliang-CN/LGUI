// FairyGUI-dom 补丁的入口：H5 后端启动时调用一次 installFairyGuiPatches()。
// 上游文件（../vendor/fairygui.module.js）不手改；能挂钩子的补丁在这里装（先调上游原方法，再补），
// 挂不上的写成同目录的 .patch，由仓库的 scripts/fairygui-dom/build.mjs 打进生成文件。台账见 ../vendor/PATCHES.md。
// 装的时候检查要挂的方法、属性、字段还在不在：不在就报 LGUI-RT-230，写清上游哪里改了、哪个补丁要重看。
import * as fgui from '../vendor/fairygui.module.js';
import {fields} from './hook';
import {installImageFill} from './image-fill';
import {installImageManifest} from './image-manifest';
import {installTextShadow, installTextStroke, textFields} from './text-format';
import {installTextShrink, shrinkFields} from './text-shrink';
import {installButtonPress, buttonFields} from './button-press';
import {installTransitionStage} from './transition-stage';
import {installNineSlice, nineSliceFields} from './nine-slice';

let installed = false;

/** 装上全部钩子（装过就不再装）。要在创建任何 FairyGUI 对象之前调用。 */
export function installFairyGuiPatches(): void {
  if (installed) return;
  installImageFill();
  installImageManifest();
  installTextShadow();
  installTextStroke();
  installTextShrink();
  installButtonPress();
  installTransitionStage();
  installNineSlice();
  checkFields();
  installed = true;
}

// 钩子里读的实例字段是上游构造函数里设的，装的时候各建一个对象查一遍。
function checkFields(): void {
  fields(2, new fgui.UIPackage(), 'UIPackage', ['_items']);
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
}
