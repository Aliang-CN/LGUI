// 项目字体：ui/fonts/<名字>.ttf 或 .otf，文件名就是字体名（defaultFont、XML 的 font、富文本的 [font=…] 都写这个名字）。
// 生成时按项目实际用到的文字做子集：网页出 WOFF2，Unity 出和原文件同格式的 TTF / OTF，写到 <输出目录>/<名字>.<扩展名>。
//
// 字集（每个字体一样）：ASCII 可见字符 + ui/ 的 XML 里写的全部文字 + i18n/ 里全部语言的文案 + 框架自己显示的固定文字
// （framework/mvc/fixed-text.ts，按工程 languages）。字体里本来就没有的字不收。
// 缺字（LGUI-CLI-141）：ui/ 里写了 font 的文字要这个字体都有；其余的静态文字（ui/ 没写 font 的、i18n/ 的、框架的固定文字）
// 要默认字体都有。运行时才知道的文字（玩家名、服务器数据）不查，缺的字由浏览器 / Unity 按字回退到系统字体。
// 工具：harfbuzzjs（HarfBuzz 的 WASM 版）读字符表、做子集；wawoff2（Google woff2 的 WASM 版）压 WOFF2。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {frameworkDir} from '../paths.mjs';
import {harfbuzz, harfbuzzSubsetWasm, woff2} from '../vendor.mjs';
import {extractTexts, readTable} from './i18n.mjs';

const FONT_NAME = /^[A-Z][A-Za-z0-9]*$/;
const FONT_EXT = /\.(ttf|otf)$/i;
const UNSUPPORTED = /\.(ttc|otc|woff2?|eot|fnt)$/i;
const HB_SUBSET_FLAGS_NO_HINTING = 1;
const HB_MEMORY_MODE_WRITABLE = 2;
const MAX_LISTED = 20;

export const fontsDir = root => path.join(root, 'ui', 'fonts');
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** ui/fonts/ 里的字体：[{ name, file, ext }]，按名字排好。文件名不合规、格式不支持报 LGUI-CLI-140（一次全部报出）。别的文件（许可说明之类）不管。 */
export function listFonts(root) {
  const dir = fontsDir(root);
  if (!fs.existsSync(dir)) return [];
  const fonts = [];
  const errors = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    if (UNSUPPORTED.test(entry.name)) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/${entry.name} 的格式不支持：项目字体只收单个字体的 TTF 或 OTF。`, {file: rel(root, file), fix: '换成 .ttf 或 .otf 文件（字体集 TTC 先拆出要用的那一个；WOFF / WOFF2 用原始的 TTF / OTF，生成时会自己压缩）。'}));
      continue;
    }
    if (!FONT_EXT.test(entry.name)) continue;
    const name = entry.name.replace(FONT_EXT, '');
    if (!FONT_NAME.test(name)) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/${entry.name} 的文件名不能当字体名：要以大写字母开头，只用字母和数字。`, {file: rel(root, file), fix: `改名，比如 ${name.replace(/[^A-Za-z0-9]/g, '').replace(/^[^A-Za-z]*/, '').replace(/^./, c => c.toUpperCase()) || 'MyFont'}${path.extname(entry.name).toLowerCase()}；文件名（去掉扩展名）就是在 defaultFont 和 XML 的 font 里写的名字。`}));
      continue;
    }
    if (fonts.some(f => f.name === name)) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/ 里有两个都叫 ${name} 的字体文件。`, {file: rel(root, file), fix: '只留一个，或者给其中一个改名。'}));
      continue;
    }
    fonts.push({name, file, ext: path.extname(entry.name).toLowerCase()});
  }
  if (errors.length) throw new LgCliErrors(errors);
  return fonts.sort((a, b) => a.name < b.name ? -1 : 1);
}

/** 工程配置的 defaultFont 不是项目字体时的报错（LGUI-CLI-142）；没问题返回 null。defaultFont 是 null 照旧可以。 */
export function defaultFontProblem(project, names) {
  if (project.defaultFont === null || names.includes(project.defaultFont)) return null;
  return new LgCliError('LGUI-CLI-142', `工程配置的 defaultFont 是 ${JSON.stringify(project.defaultFont)}，ui/fonts/ 里没有这个字体${names.length ? `（有：${names.join('、')}）` : '（现在一个字体都没有）'}。`, {
    file: '.lgui/project.json',
    fix: `把字体文件放到 ui/fonts/${project.defaultFont}.ttf（或 .otf），或者把 defaultFont 改成 ${names.length ? names.join('、') + ' 之一，或者 ' : ''}null（用系统默认字体）。系统字体名各平台不一样，不能写。`
  });
}

// 一个字：用 for…of 按码点拆，跳过控制字符。
const glyphChars = text => [...text].filter(ch => ch.codePointAt(0) >= 0x20 && ch.codePointAt(0) !== 0x7f);

// 读字体文件：格式、是不是可变字体、有哪些字。
async function inspect(root, font) {
  const bytes = fs.readFileSync(font.file);
  const where = {file: rel(root, font.file)};
  const tag = bytes.subarray(0, 4).toString('latin1');
  if (tag === 'ttcf') throw new LgCliError('LGUI-CLI-140', `ui/fonts/${path.basename(font.file)} 是字体集（TTC），不是单个字体。`, {...where, fix: '换成单个字体的 TTF 或 OTF 文件。'});
  if (!(tag === 'OTTO' || tag === 'true' || bytes.readUInt32BE(0) === 0x00010000)) throw new LgCliError('LGUI-CLI-140', `ui/fonts/${path.basename(font.file)} 不是 TTF / OTF 字体文件（内容开头不对）。`, {...where, fix: '换成能用的 TTF 或 OTF 字体文件。'});
  const hb = await harfbuzz();
  const face = new hb.Face(new hb.Blob(bytes), 0);
  if (Object.keys(face.getAxisInfos()).length) throw new LgCliError('LGUI-CLI-140', `ui/fonts/${path.basename(font.file)} 是可变字体，项目字体只收单字重的字体。`, {...where, fix: '换成单字重的文件（下载的字体包里一般在 static/ 目录下，比如 NotoSansSC-Regular.ttf）；要粗体就再放一个粗体文件当另一个字体用。'});
  const unicodes = new Set(face.collectUnicodes());
  if (!unicodes.size) throw new LgCliError('LGUI-CLI-140', `ui/fonts/${path.basename(font.file)} 读不出字符表，用不了。`, {...where, fix: '换成能用的 TTF 或 OTF 字体文件。'});
  return {bytes, unicodes};
}

/** 字集：字 → 第一次出现的位置（给缺字报错用）。required：字体名（null 表示默认字体）→ 这个字体必须有的字。 */
export async function collectChars(root, project, model) {
  const all = new Map();
  const required = new Map();
  const add = (text, where, font) => {
    for (const ch of glyphChars(text ?? '')) {
      if (!all.has(ch)) all.set(ch, where);
      if (font === undefined) continue;
      if (!required.has(font)) required.set(font, new Map());
      if (!required.get(font).has(ch)) required.get(font).set(ch, where);
    }
  };
  for (let cp = 0x20; cp < 0x7f; cp++) add(String.fromCodePoint(cp), 'ASCII');
  // ui/ 的 XML：全部属性值里的字都收（列表项、齿轮里的文字也在属性里）；写了 font 的文字控件，它的文字要这个字体有。
  const keyFont = new Map(); // ui/ 文字的键（和 i18n/ 的键一样）→ 写了的 font
  for (const pkg of model.packages) {
    for (const component of pkg.components) {
      const file = rel(root, component.file);
      const visit = node => {
        for (const value of Object.values(node.attrs ?? {})) add(String(value), file);
        for (const child of node.children ?? []) visit(child);
      };
      for (const child of component.children) {
        visit(child);
        if (!['text', 'richtext', 'inputtext'].includes(child.tag) || !child.attrs.font) continue;
        keyFont.set(`${pkg.name}/${component.name.replace(/@portrait$/, '')}/${child.name}`, child.attrs.font);
        const where = `${file}${child.line ? `:${child.line}` : ''} ${child.name}`;
        add(child.attrs.text, where, child.attrs.font);
        add(child.attrs.prompt, where, child.attrs.font);
      }
    }
  }
  for (const entry of extractTexts(model)) {
    if (keyFont.has(entry.key.replace(/@prompt$/, ''))) continue;
    add(entry.text, `ui/ ${entry.key}`, null);
    add(entry.portrait?.text, `ui/ ${entry.key}`, null); // 竖版的字和横版不一样时
  }
  // i18n/：全部语言的全部文案（按数量分开写的每一种也算）。ui/ 文字的翻译跟着那个控件的字体，其余要默认字体有。
  for (const language of project.languages) {
    const table = readTable(root, language);
    for (const [key, value] of Object.entries(table)) {
      const font = keyFont.get(key.replace(/@prompt$/, '')) ?? null;
      for (const text of typeof value === 'string' ? [value] : Object.values(value ?? {})) add(String(text), `i18n/${language}.json ${key}`, font);
    }
  }
  // 框架自己显示的固定文字（format.compact 的单位等），按工程的语言。
  const {fixedText} = await import(pathToFileURL(path.join(frameworkDir, 'mvc', 'fixed-text.ts')).href);
  for (const language of project.languages) for (const [source, text] of fixedText(language)) add(text, `${source}（${language}）`, null);
  return {all, required};
}

/** 查项目字体：文件、defaultFont、缺字。返回 { fonts: [{ name, file, ext, bytes, unicodes }], chars }；有问题一次全部报出（LgCliErrors）。 */
export async function checkFonts(root, project, model) {
  const fonts = listFonts(root);
  const errors = [];
  const problem = defaultFontProblem(project, fonts.map(f => f.name));
  if (problem) errors.push(problem);
  const loaded = [];
  for (const font of fonts) {
    try { loaded.push({...font, ...await inspect(root, font)}); } catch (error) { errors.push(error); }
  }
  const {all, required} = await collectChars(root, project, model);
  for (const [fontName, chars] of required) {
    const name = fontName ?? project.defaultFont;
    const font = loaded.find(f => f.name === name);
    if (!font) continue; // 默认字体是 null（系统字体）、字体文件有问题、XML 的 font 写错（lgui check 报 LGUI-UI-080）
    const missing = [...chars].filter(([ch]) => !font.unicodes.has(ch.codePointAt(0)));
    if (!missing.length) continue;
    const listed = missing.slice(0, MAX_LISTED).map(([ch, where]) => `「${ch}」（U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}，${where}）`).join('、');
    errors.push(new LgCliError('LGUI-CLI-141', `字体 ${name}（ui/fonts/${path.basename(font.file)}）没有这 ${missing.length} 个字：${listed}${missing.length > MAX_LISTED ? ' ……' : ''}。这些字会换成系统字体显示。`, {
      file: rel(root, font.file),
      fix: '换一个有这些字的字体；表情符号这类字体里没有的字改用图片或 ArtText；写错的字改掉。'
    }));
  }
  if (errors.length) throw new LgCliErrors(errors);
  return {fonts: loaded, chars: all};
}

let subsetExports = null;
async function subsetModule() {
  if (!subsetExports) {
    const {instance} = await WebAssembly.instantiate(fs.readFileSync(harfbuzzSubsetWasm()));
    instance.exports._initialize?.();
    subsetExports = instance.exports;
  }
  return subsetExports;
}

/** 按码点做子集，去掉 hinting；返回和原文件同格式（TTF / OTF）的字节。 */
export async function subsetFont(bytes, codepoints) {
  const hb = await subsetModule();
  const fontPtr = hb.malloc(bytes.length);
  new Uint8Array(hb.memory.buffer).set(bytes, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, bytes.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error('hb_subset_input_create_or_fail 失败');
    hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING);
    const set = hb.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) hb.hb_set_add(set, cp);
    const result = hb.hb_subset_or_fail(face, input);
    if (!result) throw new Error('hb_subset_or_fail 失败');
    const out = hb.hb_face_reference_blob(result);
    const data = hb.hb_blob_get_data(out, 0);
    const length = hb.hb_blob_get_length(out);
    const copy = new Uint8Array(hb.memory.buffer).slice(data, data + length);
    hb.hb_blob_destroy(out);
    hb.hb_face_destroy(result);
    return copy;
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}

/**
 * 生成项目字体的子集，写到 outDir/<名字>.woff2（format 'woff2'，网页）或 outDir/<名字>.ttf|.otf（format 'sfnt'，Unity）。
 * 没有项目字体时不建目录。返回字体名（按名字排好），生成的启动入口把它传给 backend.init 的 fonts。
 */
export async function generateFonts(root, project, model, outDir, format) {
  const {fonts, chars} = await checkFonts(root, project, model);
  fs.rmSync(outDir, {recursive: true, force: true});
  if (!fonts.length) return [];
  fs.mkdirSync(outDir, {recursive: true});
  const codepoints = [...chars.keys()].map(ch => ch.codePointAt(0));
  for (const font of fonts) {
    let bytes;
    try {
      bytes = await subsetFont(font.bytes, codepoints.filter(cp => font.unicodes.has(cp)));
      if (format === 'woff2') bytes = await woff2()(bytes);
    } catch (error) {
      throw new LgCliError('LGUI-CLI-140', `字体 ${font.name}（ui/fonts/${path.basename(font.file)}）做子集失败：${error.message}`, {file: rel(root, font.file), fix: '换一个能用的 TTF 或 OTF 字体文件；还不行就把这个字体文件和输出报告给维护者。'});
    }
    fs.writeFileSync(path.join(outDir, `${font.name}${format === 'woff2' ? '.woff2' : font.ext}`), bytes);
  }
  return fonts.map(f => f.name);
}

/** 只要字体名（生成启动入口、headless 用）；文件名不合规时报 LGUI-CLI-140。 */
export const fontNames = root => listFonts(root).map(f => f.name);
