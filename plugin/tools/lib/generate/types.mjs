// 由 ui/ 生成控件类型：.lgui/build/types/<包名>.d.ts 和 index.d.ts。名字写错，编译就报错。
import fs from 'node:fs';
import path from 'node:path';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {writeDir} from '../paths.mjs';

const typeNames = {
  component: 'UIComponent', text: 'UIText', richtext: 'UIRichText', input: 'UIInput', button: 'UIButton', image: 'UIImage', loader: 'UILoader', list: 'UIList', progress: 'UIProgress', graph: 'UIGraph',
  label: 'UILabel', slider: 'UISlider', combobox: 'UIComboBox', movieclip: 'UIMovieClip', tree: 'UITree', transition: 'UITransition'
};
export const PORTRAIT = '@portrait';
const isPortrait = component => component.name.endsWith(PORTRAIT);

// 组件的绑定成员：键 → { kind, ref?, pages? }。没导出的子组件一层层展开成点号路径，遇到导出组件为止。
export function members(component, prefix = '', seen = new Set()) {
  const result = new Map();
  const errors = [];
  if (seen.has(component)) return {result, errors};
  seen = new Set(seen).add(component);
  const names = new Map();
  for (const controller of component.controllers) {
    // 按钮、下拉框自带的 button 状态控制器是 FairyGUI 内部用的，不进类型。
    if (['Button', 'ComboBox'].includes(component.extension) && controller.name === 'button') continue;
    const key = prefix + controller.name;
    names.set(controller.name, 'controller');
    result.set(key, {kind: 'controller', pages: controller.pages.map(page => page.name), line: controller.line, file: component.file});
  }
  for (const child of component.children) {
    if (!child.kind || !child.name) continue;
    if (names.has(child.name)) {
      const clash = names.get(child.name) === 'controller';
      errors.push(new LgCliError(clash ? 'LGUI-UI-005' : 'LGUI-UI-004', clash
        ? `组件 ${component.fullName} 里控件 ${child.name} 和控制器同名。`
        : `组件 ${component.fullName} 里有两个控件都叫 ${child.name}。`, {file: uiFile(component), line: child.line, fix: clash ? '给控件或控制器换一个名字。' : '控件名在组件内要唯一，给其中一个换名字。'}));
      continue;
    }
    names.set(child.name, 'child');
    const key = prefix + child.name;
    result.set(key, {kind: child.kind, ref: child.ref?.exported ? child.ref.fullName : null, line: child.line, file: component.file});
    // 没导出的子组件（包括按钮、进度条）：继续展开它里面的控件。
    if (child.ref && !child.ref.exported && child.tag === 'component') {
      const nested = members(child.ref, key + '.', seen);
      errors.push(...nested.errors);
      for (const [nestedKey, value] of nested.result) result.set(nestedKey, value);
    }
  }
  // 动效：动效名也是绑定表的键，不能和控件、控制器重名。
  for (const name of component.transitions) {
    if (!name) continue;
    if (names.has(name)) {
      errors.push(new LgCliError('LGUI-UI-005', `组件 ${component.fullName} 里动效 ${name} 和${names.get(name) === 'controller' ? '控制器' : '控件'}同名。`, {file: component.file, line: lineOf(component, name), fix: '给动效换一个名字。'}));
      continue;
    }
    names.set(name, 'transition');
    result.set(prefix + name, {kind: 'transition', line: lineOf(component, name), file: component.file});
  }
  return {result, errors};
}

// 动效在组件 XML 里的行号（报错用）。
function lineOf(component, name) {
  const index = fs.readFileSync(component.file, 'utf8').split('\n').findIndex(line => line.includes(`<transition name="${name}"`));
  return index >= 0 ? index + 1 : undefined;
}

function describe(member) {
  if (!member) return '没有';
  if (member.kind === 'controller') return `控制器（页 ${member.pages.join('、')}）`;
  return member.kind;
}

// 横竖两版的控件名和类型必须一致，不一致报 LGUI-UI-007 并列出差异。
export function comparePortrait(landscape, portrait, landscapeMembers, portraitMembers) {
  const diffs = [];
  for (const key of new Set([...landscapeMembers.keys(), ...portraitMembers.keys()])) {
    const a = landscapeMembers.get(key);
    const b = portraitMembers.get(key);
    if (!a || !b || a.kind !== b.kind || (a.kind === 'controller' && a.pages.join() !== b.pages.join())) diffs.push(`${key}：横版${describe(a)}，竖版${describe(b)}`);
  }
  if (!diffs.length) return [];
  return [new LgCliError('LGUI-UI-007', `${landscape.fullName} 和 ${portrait.fullName} 的控件不一致：${diffs.join('；')}。`, {file: uiFile(portrait), fix: '两版的控件名、类型、控制器和页名要完全一致；改成一样的再生成。'})];
}

function tsType(member) {
  if (member.kind === 'controller') return `UIController<${member.pages.length ? member.pages.map(page => `'${page}'`).join(' | ') : 'string'}>`;
  if (member.kind === 'component' && member.ref) return `UIComponent<'${member.ref}'>`;
  return typeNames[member.kind];
}

const quoteKey = key => /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`;

// 生成全部类型文件，返回 { files, components }；有错误一次全部抛出。
export function generateTypes(model, out) {
  const errors = [];
  const perPackage = new Map();
  const index = [];
  for (const pkg of model.packages) {
    for (const component of pkg.components.filter(item => item.exported && !isPortrait(item))) {
      const {result, errors: memberErrors} = members(component);
      errors.push(...memberErrors);
      const portrait = pkg.components.find(item => item.name === component.name + PORTRAIT);
      if (portrait) {
        const other = members(portrait);
        errors.push(...other.errors, ...comparePortrait(component, portrait, result, other.result));
      }
      const lines = [`/** ${component.fullName}${portrait ? '（横版和 @portrait 竖版共用）' : ''} */`, `export interface ${component.name}UI {`, `  readonly __component: '${component.fullName}';`];
      for (const [key, member] of result) lines.push(`  ${quoteKey(key)}: ${tsType(member)};`);
      lines.push('}');
      if (!perPackage.has(pkg.name)) perPackage.set(pkg.name, []);
      perPackage.get(pkg.name).push(lines.join('\n'));
      index.push(component);
    }
  }
  if (errors.length) throw new LgCliErrors(errors);
  const header = "// 由 ui/ 生成，不要手改。\nimport type { UIComponent, UIText, UIRichText, UIInput, UIButton, UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, UILabel, UISlider, UIComboBox, UIMovieClip, UITree } from 'lgui';\n";
  const contents = new Map();
  for (const [pkgName, blocks] of perPackage) contents.set(`${pkgName}.d.ts`, `${header}\n${blocks.join('\n\n')}\n`);
  const indexLines = ['// 由 ui/ 生成，不要手改。'];
  for (const pkgName of perPackage.keys()) indexLines.push(`export * from './${pkgName}';`);
  for (const component of index) indexLines.push(`import type { ${component.name}UI as ${component.pkg.name}_${component.name} } from './${component.pkg.name}';`);
  indexLines.push('', '/** 「包/组件」名 → 控件类型。 */', 'export interface LGUIComponents {');
  for (const component of index) indexLines.push(`  '${component.fullName}': ${component.pkg.name}_${component.name};`);
  indexLines.push('}', '');
  contents.set('index.d.ts', indexLines.join('\n'));
  // 几条命令共用这个目录：只写新文件、删多余的（不整个删掉重建）
  const files = writeDir(out, contents);
  return {files, components: index.map(component => component.fullName)};
}

// 报错里的组件文件：相对工程根目录（ui/assets/<包>/ 往上三级），用 /。
function uiFile(component) {
  return path.relative(path.resolve(component.pkg.dir, '../../..'), component.file).split(path.sep).join('/');
}
