// 从 ui/ 生成网页和 Unity 用的界面包。不是单独的命令，由 lgui dev、verify、test、unity export 调用。每次都全部重新生成。
import fs from 'node:fs';
import path from 'node:path';
import {generateWeb} from './web.mjs';
import {generateUnity} from './unity.mjs';
import {readUiProject} from './read.mjs';
import {readUiModel} from './model.mjs';
import {generateTypes} from './types.mjs';
import {generateHeadless} from './headless.mjs';

export {generateWeb, generateUnity, readUiModel, generateTypes, generateHeadless};

// 工程里的固定位置：界面工程 ui/UI.fairy；几条命令共用的类型和 headless 描述。网页界面包由各命令写进自己的生成目录（paths.mjs 的 buildDir）。
export const uiProjectPath = root => path.join(root, 'ui', 'UI.fairy');
export const typesDir = root => path.join(root, '.lgui', 'build', 'types');
export const headlessDir = root => path.join(root, '.lgui', 'build', 'headless');

// 控件类型和 headless 描述（先用 OpenFairyGUI 校验 ui/）。
// validated：调用方已经用 OpenFairyGUI 校验过 ui/ 了（比如刚生成过网页界面包），不用再校验一遍。
export async function generateProjectTypes(root, {validated = false} = {}) {
  if (!validated) await readUiProject(uiProjectPath(root));
  const model = readUiModel(uiProjectPath(root));
  const deps = packageDeps(model);
  fs.mkdirSync(path.join(root, '.lgui', 'build'), {recursive: true});
  fs.writeFileSync(depsPath(root), JSON.stringify(deps, null, 2) + '\n');
  return {model, deps, types: generateTypes(model, typesDir(root)), headless: generateHeadless(model, headlessDir(root))};
}

export const depsPath = root => path.join(root, '.lgui', 'build', 'deps.json');

// 每个包依赖哪些别的包（子组件、列表子项、下拉框弹出的列表引用了别的包里的组件，图片 <image pkg="包ID"> 用了别的包里的图片）。
// 打开界面时先加载这些包（依赖的依赖也加载）。
export function packageDeps(model) {
  const deps = {};
  for (const pkg of model.packages) {
    const set = new Set();
    for (const component of pkg.components) {
      for (const child of component.children) {
        if (child.ref && child.ref.pkg !== pkg) set.add(child.ref.pkg.name);
        const imagePkg = child.tag === 'image' && child.attrs.pkg && child.attrs.pkg !== pkg.id ? model.byId.get(child.attrs.pkg) : null;
        if (imagePkg) set.add(imagePkg.name);
      }
      // 下拉框组件的 <ComboBox dropdown="ui://包ID资源ID"/>：弹出的列表可以放在别的包里。
      const dropdown = component.extension === 'ComboBox' ? component.root.children.find(child => child.tag === 'ComboBox')?.attrs.dropdown ?? '' : '';
      const target = dropdown.startsWith('ui://') ? model.byId.get(dropdown.slice(5, dropdown.length - 8)) : null;
      if (target && target !== pkg) set.add(target.name);
    }
    deps[pkg.name] = [...set].sort();
  }
  return deps;
}

