// 多语言：从 ui/ 提取用户能看到的固定文字；按文本表生成 FairyGUI 的翻译文件。
// 键名：<包>/<组件>/<控件名>（竖版和横版共用一个键，原文取横版的）；输入框的提示是 <控件名>@prompt，下拉框的第 j 项是 <控件名>@item<j>。FairyGUI 翻译文件里的名字：<包ID><组件ID>-<元素ID>[-prompt]。
import fs from 'node:fs';
import path from 'node:path';
import {LgCliError} from '../errors.mjs';
import {writeDir} from '../paths.mjs';

const xmlEscape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 提取：[{ key, text, targets: [{ name }], portrait? }]，name 是翻译文件里的名字。
 *  text 取横版的文字（横版没写字时取竖版的）；两版的字不一样时 portrait 是 { text, landscapeText, file }（lgui check 警告）。 */
export function extractTexts(model) {
  const byKey = new Map();
  const add = (key, text, name, component) => {
    let entry = byKey.get(key);
    if (!entry) { entry = {key, targets: []}; byKey.set(key, entry); }
    entry[component.name.endsWith('@portrait') ? 'portraitText' : 'landscapeText'] = text;
    if (component.name.endsWith('@portrait')) entry.portraitFile = component.file;
    if (text) entry.targets.push({name});
  };
  for (const pkg of model.packages) {
    for (const component of pkg.components) {
      const base = `${pkg.name}/${component.name.replace(/@portrait$/, '')}`;
      const owner = `${pkg.id}${component.id}`;
      for (const child of component.children) {
        if (!child.name || !child.id) continue;
        const key = `${base}/${child.name}`;
        const name = `${owner}-${child.id}`;
        if (['text', 'richtext'].includes(child.tag)) add(key, child.attrs.text ?? '', name, component);
        if (child.tag === 'inputtext') {
          add(key, child.attrs.text ?? '', name, component);
          add(`${key}@prompt`, child.attrs.prompt ?? '', `${name}-prompt`, component);
        }
        if (child.tag === 'component') {
          const button = child.children.find(node => node.tag === 'Button');
          if (button) add(key, button.attrs.title ?? '', name, component);
          const label = child.children.find(node => node.tag === 'Label');
          if (label) add(key, label.attrs.title ?? '', name, component);
          // 下拉框：第 j 项的键是 <控件名>@item<j>，翻译名是 <元素ID>-<j>。FairyGUI 按标题文字认出选中项，所以标题跟着它对应的那一项一起翻译。
          const combo = child.children.find(node => node.tag === 'ComboBox');
          if (combo) {
            combo.children.filter(node => node.tag === 'item').forEach((item, j) => {
              const text = item.attrs.title ?? '';
              add(`${key}@item${j}`, text, `${name}-${j}`, component);
              if (text && combo.attrs.title === text) add(`${key}@item${j}`, text, name, component);
            });
          }
        }
      }
    }
  }
  return [...byKey.values()].filter(e => e.landscapeText || e.portraitText).map(({key, targets, landscapeText, portraitText, portraitFile}) => ({
    key, text: landscapeText || portraitText, targets,
    ...(landscapeText !== undefined && portraitText !== undefined && landscapeText !== portraitText ? {portrait: {text: portraitText, landscapeText, file: portraitFile}} : {})
  }));
}

/** 读一种语言的文本表；不存在返回 {}。 */
export function readTable(root, language) {
  const file = path.join(root, 'i18n', `${language}.json`);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new LgCliError('LGUI-CLI-031', `文本表 i18n/${language}.json 不是合法的 JSON：${error.message}`, {file: `i18n/${language}.json`, fix: '改成合法的 JSON。'});
  }
}

/** 一种语言的翻译文件（FairyGUI 的 <resources><string name=…>…</string></resources>）。 */
export function translationXml(entries, table) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>'];
  for (const entry of entries) {
    const value = table[entry.key];
    if (typeof value !== 'string') continue;
    for (const target of entry.targets) lines.push(`  <string name="${xmlEscape(target.name)}">${xmlEscape(value)}</string>`);
  }
  lines.push('</resources>', '');
  return lines.join('\n');
}

/** 每种语言：翻译文件里的名字 → 文字（给 headless 后端用）。默认语言的固定文字以 ui/ 为准，不翻译。 */
export function translationMaps(entries, tables, defaultLanguage) {
  return Object.fromEntries(Object.entries(tables).map(([language, table]) => [language, language === defaultLanguage ? {} : Object.fromEntries(
    entries.flatMap(entry => typeof table[entry.key] === 'string' ? entry.targets.map(t => [t.name, table[entry.key]]) : [])
  )]));
}

/** 生成全部语言的翻译文件到 outDir/<语言>.xml，并写对照表 .lgui/build/i18n/map.json。
 *  默认语言的固定文字以 ui/ 为准：它的翻译文件是空的（切回默认语言时显示 ui/ 里的原文），改 ui/ 马上生效。 */
export function generateTranslations(root, model, languages, outDir, defaultLanguage) {
  const entries = extractTexts(model);
  const tables = {};
  const files = new Map();
  for (const language of languages) {
    tables[language] = readTable(root, language);
    files.set(`${language}.xml`, translationXml(entries, language === defaultLanguage ? {} : tables[language]));
  }
  writeDir(outDir, files);
  const mapFile = path.join(root, '.lgui', 'build', 'i18n', 'map.json');
  fs.mkdirSync(path.dirname(mapFile), {recursive: true});
  fs.writeFileSync(mapFile, JSON.stringify(Object.fromEntries(entries.map(e => [e.key, e.targets.map(t => t.name)])), null, 2) + '\n');
  return {entries, tables};
}
