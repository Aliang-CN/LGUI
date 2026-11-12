// UI 开发规范的检查规则（LGUI-UI-xxx），读 ui/ 来查。规则表见 references/ui-spec.md 第 13 节。
import fs from 'node:fs';
import path from 'node:path';
import {finding} from './program.mjs';
import {members, comparePortrait, PORTRAIT} from '../generate/types.mjs';
import {findComponent} from '../generate/model.mjs';

const ID = /^[a-z0-9]{8}$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const MIN_FONT = 20;
const DEFAULT_FONT = 12; // XML 里不写 fontSize 时 FairyGUI 用 12 号
const AUTO_SIZES = ['shrink', 'height', 'ellipsis', 'both'];
const DEFAULT_LEADING = 3; // XML 里不写 leading 时 FairyGUI 的行距

// 按钮、标签、下拉框的文字（实例上的 title、下拉框的选项、绑定表的 text / items、翻译）只写进组件里名为 title 的子控件：FairyGUI 按名字找，找不到就不显示。
const TITLED = {Button: '按钮', Label: '标签', ComboBox: '下拉框'};
const titleless = c => Boolean(TITLED[c?.extension]) && !c.children.some(ch => ch.name === 'title');
const titleFix = c => {
  const texts = c.children.filter(ch => ['text', 'richtext'].includes(ch.tag) && ch.name).map(ch => ch.name);
  return `把 ${c.fullName} 里显示文字的控件改名为 title${texts.length ? `（现在的文字控件：${texts.join('、')}）` : '（现在没有文字控件，加一个名为 title 的文字控件）'}。按钮、标签、下拉框的文字只写进名为 title 的子控件。`;
};
// 写了什么：按钮、标签是标题，下拉框是选中项的文字
const shows = c => c.extension === 'ComboBox' ? '选中项的文字' : '标题';
// 按钮、标签、下拉框的图标（实例上的 icon / selectedIcon、绑定表的 icon）只写进组件里名为 icon 的子控件：FairyGUI 按名字找，找不到就不显示。
const iconless = c => Boolean(TITLED[c?.extension]) && !c.children.some(ch => ch.name === 'icon');
const iconFix = c => {
  const loaders = c.children.filter(ch => ch.tag === 'loader' && ch.name).map(ch => ch.name);
  return `在 ${c.fullName} 里加一个名为 icon 的装载器（loader）子控件${loaders.length ? `，或者把现有的装载器（${loaders.join('、')}）改名为 icon` : ''}。按钮、标签、下拉框的图标只写进名为 icon 的子控件。`;
};

const ICON_URL_RE = /^icon:\/\/([A-Za-z0-9][A-Za-z0-9._/-]*)$/;

/** 扫描工程配置和 ui/ XML 里出现的全部 icon:// 地址（lgui check 和 lgui unity export 共用）。 */
export function collectUiIconUrls(root, model, placeholder = null) {
  const rel = file => path.relative(root, file).split(path.sep).join('/');
  const out = [];
  if (typeof placeholder === 'string' && placeholder.startsWith('icon://')) {
    out.push({url: placeholder, file: '.lgui/project.json', line: 1, where: '工程配置 placeholder'});
  }
  for (const pkg of model.packages) {
    for (const component of pkg.components) {
      const file = rel(component.file);
      for (const child of component.children) {
        if (child.tag === 'loader' && child.attrs.url?.startsWith('icon://')) {
          out.push({url: child.attrs.url, file, line: child.line, where: `组件 ${component.fullName} 的装载器 ${child.name}`});
        }
        const ext = child.children.find(n => ['Button', 'Label', 'ComboBox'].includes(n.tag));
        if (ext) {
          for (const attrName of ['icon', 'selectedIcon']) {
            if (ext.attrs[attrName]?.startsWith('icon://')) {
              out.push({url: ext.attrs[attrName], file, line: child.line, where: `组件 ${component.fullName} 的${TITLED[ext.tag]} ${child.name}`});
            }
          }
          for (const item of ext.children ?? []) {
            if (item.tag === 'item' && item.attrs.icon?.startsWith('icon://')) {
              out.push({url: item.attrs.icon, file, line: child.line, where: `组件 ${component.fullName} 的下拉框 ${child.name}`});
            }
          }
        }
        for (const gear of child.children.filter(n => n.tag === 'gearIcon')) {
          for (const val of [...(gear.attrs.values ?? '').split('|'), gear.attrs.default ?? '']) {
            if (val.startsWith('icon://')) {
              out.push({url: val, file, line: child.line, where: `组件 ${component.fullName} 的 ${child.name} 的 gearIcon`});
            }
          }
        }
      }
    }
  }
  return out;
}

function iconUrlProblem(url, codeIcons) {
  const m = ICON_URL_RE.exec(url);
  if (!m) {
    return {
      message: `代码图标地址「${url}」写法不对（要写成 icon://<名字>，名字以字母或数字开头，只能用字母、数字和 . _ / -）`,
      fix: "改成比如 'icon://play'、'icon://hud/sword'。"
    };
  }
  if (codeIcons && !codeIcons.dynamic && !codeIcons.names.has(m[1])) {
    return {
      message: `代码图标 ${url} 没有在代码里注册`,
      fix: `在 src/main.ts 的 lgui.app({ icons }) 里注册 '${m[1]}'，或者调用 lgui.registerIcons({ '${m[1]}': ... })。`
    };
  }
  return null;
}

// 动效里旋转、缩放的值都是原样（缩放 1,1、旋转 0）时不需要轴心。
const IDENTITY = {Scale: v => v.split(',').every(n => Number(n) === 1), Rotation: v => Number(v) === 0};

// Common 包里的固定组件和必有控件（UI 开发规范第 10 节）。
const COMMON = {
  Toast: ['text'], Confirm: ['title', 'message', 'ok', 'cancel'], Loading: ['text'], ActionHintBar: ['list'], ActionHint: ['key', 'label'],
  RedDot: ['count'], HoldProgress: [], ArtText: []
};

/** ui:// 地址指向的资源：ui://<包ID><资源ID> 或 ui://<包名>/<资源名>。找不到返回 null。 */
export function resourceByUrl(model, url) {
  const m = /^ui:\/\/(?:([a-z0-9]{8})([a-z0-9]{8})|([A-Z][A-Za-z0-9]*)\/(.+))$/.exec(url ?? '');
  const pkg = m && (m[1] ? model.byId.get(m[1]) : model.packages.find(p => p.name === m[3]));
  const res = pkg?.resources.find(r => m[1] ? r.id === m[2] : r.name === m[4]);
  return res ? {pkg, res} : null;
}

// 图片有 @<语言> 版本（带字图片）
const hasLanguages = (pkg, image) => image.type === 'image' && pkg.resources.some(r => r.type === 'image' && r.name.startsWith(image.name + '@'));

const SYNTH_URL_RE = /^synth:\/\/([A-Za-z0-9][A-Za-z0-9._/-]*)$/;

/** 音效地址的问题：不存在、没登记、不是 mp3，或者 synth:// 写法不对、没配自定义 audio 出口；没问题返回 null。 */
export function soundProblem(model, url, {customAudio = false} = {}) {
  if (typeof url === 'string' && url.startsWith('synth://')) {
    if (!SYNTH_URL_RE.test(url)) return `合成声音地址「${url}」写法不对（要写成 synth://<名字>，名字以字母或数字开头，只能用字母、数字和 . _ / -）`;
    if (!customAudio) return `用了代码合成声音 ${url}，但没有在 lgui.app({ platform: { audio } }) 里提供自定义的声音出口`;
    return null;
  }
  const found = resourceByUrl(model, url);
  if (!found) return `${url} 没有登记在 ui/ 的包里（地址写成 ui://包名/音效名，或者代码合成声音写成 synth://名字）`;
  const {res} = found;
  if (res.type !== 'sound') return `${url} 不是音效（package.xml 里登记的是 ${res.type}）`;
  if (!/\.mp3$/i.test(res.fileName)) return `${url} 是 ${res.fileName}，音效只用 mp3`;
  if (!fs.existsSync(res.file)) return `${url} 登记的文件 ${res.path}${res.fileName} 不存在`;
  const head = Buffer.alloc(3);
  const fd = fs.openSync(res.file, 'r');
  try { fs.readSync(fd, head, 0, 3, 0); } finally { fs.closeSync(fd); }
  if (!(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))) return `${res.path}${res.fileName} 的内容不是 mp3 格式`;
  return null;
}

export function uiRules({root, model, languages, redDots = [], texts = [], items = [], iconBindings = [], fullScreens = [], sounds = null, placeholder = null, codeIcons = null, customAudio = false}) {
  const out = [];
  const rel = file => path.relative(root, file).split(path.sep).join('/');
  const add = (code, message, fix, file, line) => out.push(finding(code, message, fix, {file: file ? rel(file) : undefined, line, col: 1}));
  const soundFix = '音效用 mp3 放进包目录并登记进 package.xml（<sound id="…" name="click.mp3" path="/" exported="true"/>），地址写 ui://包名/音效名；或者用代码合成声音写 synth://<名字>（并在 lgui.app({ platform: { audio } }) 提供自定义声音出口）；不要声音就写 sound=""。';

  // UI-001 包 ID
  const pkgIds = new Map();
  for (const pkg of model.packages) {
    if (!ID.test(pkg.id ?? '')) add('LGUI-UI-001', `包 ${pkg.name} 的 ID「${pkg.id}」不是 8 位小写字母和数字。`, '改成 8 位小写字母和数字，比如 bag00001。', pkg.file, 2);
    if (pkgIds.has(pkg.id)) add('LGUI-UI-001', `包 ${pkg.name} 和 ${pkgIds.get(pkg.id)} 的 ID 都是 ${pkg.id}。`, '包 ID 在整个工程里要唯一。', pkg.file, 2);
    pkgIds.set(pkg.id, pkg.name);
    if (!PASCAL.test(pkg.name)) add('LGUI-UI-006', `包名 ${pkg.name} 要写成大写开头的驼峰。`, '比如 Bag、Common。', pkg.file, 1);
  }

  for (const pkg of model.packages) {
    // UI-002 资源 ID、UI-018 登记和文件对得上
    const resIds = new Set();
    for (const r of pkg.resources) {
      if (!ID.test(r.id ?? '')) add('LGUI-UI-002', `包 ${pkg.name} 的资源 ${r.fileName} 的 ID「${r.id}」不是 8 位小写字母和数字。`, '改成 8 位小写字母和数字。', pkg.file);
      if (resIds.has(r.id)) add('LGUI-UI-002', `包 ${pkg.name} 里有两个资源的 ID 都是 ${r.id}。`, '资源 ID 在包内要唯一。', pkg.file);
      resIds.add(r.id);
      if (!fs.existsSync(r.file)) add('LGUI-UI-018', `package.xml 登记了 ${r.path}${r.fileName}，但文件不存在。`, '把文件放回去，或者从 package.xml 里删掉这条。', pkg.file);
      // UI-006 名字
      if (r.type === 'component') {
        const [base, suffix] = r.name.split('@');
        if (!PASCAL.test(base) || (suffix !== undefined && suffix !== 'portrait')) add('LGUI-UI-006', `组件名 ${r.name} 不合规范：大写开头的驼峰，后缀只能是 @portrait。`, '比如 BagPanel、BagPanel@portrait。', pkg.file);
      }
      if (r.type === 'image') {
        const [, lang] = r.name.split('@');
        if (lang !== undefined) {
          // UI-017 带字图片：有默认版本，语言在 languages 里
          if (!languages.includes(lang)) add('LGUI-UI-017', `图片 ${r.name} 的语言 ${lang} 不在工程配置 languages 里。`, `把 ${lang} 加进 languages，或者改图片名。`, pkg.file);
          if (!pkg.resources.some(x => x.type === 'image' && x.name === r.name.split('@')[0])) add('LGUI-UI-017', `图片 ${r.name} 没有不带后缀的默认版本 ${r.name.split('@')[0]}。`, '加一张默认版本的图片。', pkg.file);
        }
        // UI-015 九宫格
        const scale = r.attrs.scale, grid = r.attrs.scale9grid;
        if ((scale === '9grid') !== Boolean(grid)) add('LGUI-UI-015', `图片 ${r.name} 的 scale="9grid" 和 scale9grid 要成对出现。`, '两个属性一起写。', pkg.file);
        if (grid && r.attrs.width && r.attrs.height) {
          const [x, y, w, h] = grid.split(',').map(Number);
          if (x < 0 || y < 0 || x + w > Number(r.attrs.width) || y + h > Number(r.attrs.height)) add('LGUI-UI-015', `图片 ${r.name} 的九宫格区域超出了图片。`, '按图片真实的边框像素改 scale9grid。', pkg.file);
        }
      }
    }
    // UI-018 包目录里没登记的文件
    const registered = new Set(pkg.resources.map(r => path.resolve(r.file)));
    const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    for (const file of walk(pkg.dir)) {
      if (path.basename(file) === 'package.xml' || !/\.(xml|png|jpg|jpeg|mp3|wav|ogg)$/i.test(file)) continue;
      if (!registered.has(path.resolve(file))) add('LGUI-UI-018', `${rel(file)} 放在包目录里，但没有登记进 package.xml。`, '登记进 package.xml，或者删掉它。', file);
    }

    for (const component of pkg.components) {
      // UI-065 按钮组件自己写的音效
      const ownSound = component.root?.children.find(n => n.tag === 'Button')?.attrs.sound;
      if (ownSound) { const problem = soundProblem(model, ownSound, {customAudio}); if (problem) add('LGUI-UI-065', `按钮组件 ${component.fullName} 的音效不对：${problem}。`, soundFix, component.file, 1); }
      // UI-003 元素 ID、UI-004 控件名
      const ids = new Set();
      for (const child of component.children) {
        if (child.id && ids.has(child.id)) add('LGUI-UI-003', `组件 ${component.fullName} 里有两个元素的 ID 都是 ${child.id}。`, '元素 ID 在组件内要唯一，写 n 加数字。', component.file, child.line);
        if (child.id) ids.add(child.id);
        if (child.name && !CAMEL.test(child.name)) add('LGUI-UI-004', `组件 ${component.fullName} 的控件名 ${child.name} 要写成小写开头的驼峰。`, '比如 sellButton。', component.file, child.line);
        // UI-010 超长处理；UI-011 字号
        if (['text', 'richtext'].includes(child.tag)) {
          if (!AUTO_SIZES.includes(child.attrs.autoSize)) add('LGUI-UI-010', `组件 ${component.fullName} 的文字控件 ${child.name} 没写超长处理（autoSize）。`, '写 autoSize="shrink"、"height"、"ellipsis" 或 "both"（UI 开发规范第 8 节）。', component.file, child.line);
          // UI-068 缩小、省略号的文字，框只放得下一行却没写 singleLine：字长了会先折成两行，再缩成小字或者被截掉
          const fontSize = Number(child.attrs.fontSize ?? DEFAULT_FONT), leading = Number(child.attrs.leading ?? DEFAULT_LEADING);
          const height = Number((child.attrs.size ?? '').split(',')[1]);
          if (['shrink', 'ellipsis'].includes(child.attrs.autoSize) && child.attrs.singleLine !== 'true' && height > 0 && height < 2 * fontSize + leading) add('LGUI-UI-068', `组件 ${component.fullName} 的文字控件 ${child.name} 写了 autoSize="${child.attrs.autoSize}"，框高 ${height} 只放得下一行（${fontSize} 号字），但没写 singleLine="true"：字长了会折成两行再${child.attrs.autoSize === 'shrink' ? '缩成小字' : '被截掉'}。`, '加上 singleLine="true"；要显示多行就把框加高到放得下两行以上，或者改成 autoSize="height"。', component.file, child.line);
        }
        if (['text', 'richtext', 'inputtext'].includes(child.tag) && Number(child.attrs.fontSize ?? DEFAULT_FONT) < MIN_FONT) add('LGUI-UI-011', `组件 ${component.fullName} 的 ${child.name} ${child.attrs.fontSize ? `字号是 ${child.attrs.fontSize}` : `没写 fontSize（FairyGUI 默认 ${DEFAULT_FONT} 号）`}，小于最小字号 ${MIN_FONT}。`, `写 fontSize="${MIN_FONT}" 或更大。`, component.file, child.line);
        // UI-060 gearText 里写了用户能看到的文字：不会被提取翻译，headless 也不模拟
        for (const gear of child.children.filter(n => n.tag === 'gearText')) {
          const texts = [...(gear.attrs.values ?? '').split('|'), gear.attrs.default ?? ''].filter(t => t.trim());
          if (texts.length) add('LGUI-UI-060', `组件 ${component.fullName} 的 ${child.name} 在 gearText 里写了用户能看到的文字（${texts.join('|')}）。这些字不会被提取翻译，lgui test 里也看不到。`, '删掉 gearText，改用绑定表：text: pick(数据, s => lgui.t(键))，文字写进 i18n/<语言>.json。', component.file, child.line);
        }
        const button = child.children.find(n => n.tag === 'Button' || n.tag === 'Label');
        // UI-066 按钮、标签实例上写了标题/图标，下拉框实例上写了选项/图标，组件里却没有 title / icon 子控件：网页上显示不出来
        const own = child.ref && child.children.find(n => n.tag === child.ref.extension);
        const written = own && (own.attrs.title || (own.tag === 'ComboBox' && own.children.some(n => n.tag === 'item' && n.attrs.title)));
        if (written && titleless(child.ref)) add('LGUI-UI-066', `组件 ${component.fullName} 的${TITLED[own.tag]} ${child.name} 写了${own.attrs.title ? `标题「${own.attrs.title}」` : '选项'}，但${TITLED[own.tag]}组件 ${child.ref.fullName} 里没有名为 title 的子控件，${shows(child.ref)}在网页上显示不出来。`, titleFix(child.ref), component.file, child.line);
        const writtenIcon = own && (own.attrs.icon || own.attrs.selectedIcon || (own.tag === 'ComboBox' && own.children.some(n => n.tag === 'item' && n.attrs.icon)));
        if (writtenIcon && iconless(child.ref)) add('LGUI-UI-066', `组件 ${component.fullName} 的${TITLED[own.tag]} ${child.name} 写了图标，但${TITLED[own.tag]}组件 ${child.ref.fullName} 里没有名为 icon 的子控件，图标显示不出来。`, iconFix(child.ref), component.file, child.line);
        // UI-061 按钮直接绑控制器（点了就切页）：绕过了 Model，lgui test 里也不切
        if (button?.tag === 'Button' && button.attrs.controller) add('LGUI-UI-061', `组件 ${component.fullName} 的按钮 ${child.name} 直接绑了控制器 ${button.attrs.controller}（点了就切页）。这样切页不经过 Model，lgui test 里也不会切。`, '删掉 <Button> 上的 controller 和 page；在绑定表里写 click: () => xxxController.方法()，由 Controller 改 Model，控制器写 page: pick(…)。', component.file, child.line);
        // UI-065 按钮实例上写的音效；写空表示不出声
        if (button?.tag === 'Button' && button.attrs.sound) { const problem = soundProblem(model, button.attrs.sound, {customAudio}); if (problem) add('LGUI-UI-065', `组件 ${component.fullName} 的按钮 ${child.name} 的音效不对：${problem}。`, soundFix, component.file, child.line); }
        // UI-017 装载器的 url、按钮的 icon 写死了带字图片：不会随语言换
        for (const url of [child.tag === 'loader' ? child.attrs.url : null, button?.attrs.icon]) {
          const found = url ? resourceByUrl(model, url) : null;
          if (found && hasLanguages(found.pkg, found.res)) add('LGUI-UI-017', `组件 ${component.fullName} 的 ${child.name} 在 ui/ 里写死了带字图片 ${url}，不会随语言换。`, `ui/ 里留空，在绑定表里写 icon: 'ui://${found.pkg.name}/${found.res.name}'。`, component.file, child.line);
        }
        // UI-009 引用存在
        if (child.tag === 'component' && !child.ref) add('LGUI-UI-009', `组件 ${component.fullName} 的子组件 ${child.name} 引用的组件不存在（src="${child.attrs.src}"）。`, '指向一个存在的组件；跨包引用要写 pkg，并且对方已导出。', component.file, child.line);
        if (child.tag === 'component' && child.ref && child.ref.pkg !== pkg && !child.ref.exported) add('LGUI-UI-009', `组件 ${component.fullName} 引用了别的包里没导出的组件 ${child.ref.fullName}。`, '在对方的 package.xml 里给它写 exported="true"。', component.file, child.line);
        if (child.tag === 'image' && child.attrs.src) {
          const target = model.byId.get(child.attrs.pkg ?? pkg.id);
          const image = target?.resources.find(r => r.id === child.attrs.src);
          // UI-017 带字图片放在图片控件里，不会随语言换
          if (image && hasLanguages(target, image)) add('LGUI-UI-017', `组件 ${component.fullName} 的图片控件 ${child.name} 用的 ${image.name} 有各语言版本，但图片控件不会随语言换。`, `换成装载器，在绑定表里写 icon: 'ui://${target.name}/${image.name}'。`, component.file, child.line);
          if (!target?.resources.some(r => r.id === child.attrs.src)) add('LGUI-UI-009', `组件 ${component.fullName} 的图片 ${child.name} 引用的资源 ${child.attrs.src} 不存在。`, '指向一个存在的图片资源；别的包里的图片写 pkg（包 ID）和 src（资源 ID）。', component.file, child.line);
          if (image && target !== pkg && !image.exported) add('LGUI-UI-009', `组件 ${component.fullName} 的图片 ${child.name} 引用了别的包里没导出的图片 ${target.name}/${image.name}。`, '在对方的 package.xml 里给它写 exported="true"。', component.file, child.line);
        }
        // UI-020 编辑器保存不了的跨包写法（警告）：子组件跨包写了 fileName
        if (child.tag === 'component' && child.attrs.pkg && child.attrs.pkg !== pkg.id && child.attrs.fileName) out.push(finding('LGUI-UI-020', `组件 ${component.fullName} 的子组件 ${child.name} 跨包引用写了 fileName，编辑器保存不了这个工程。`, '删掉 fileName，只写 pkg 和 src。', {file: rel(component.file), line: child.line, col: 1, level: 'warning'}));
        // UI-016 列表 defaultItem
        if (child.tag === 'list' && (!child.ref || !child.ref.exported)) add('LGUI-UI-016', `组件 ${component.fullName} 的列表 ${child.name} 的 defaultItem 没设，或者指向的组件不存在、没导出。`, '写 defaultItem="ui://<包ID><组件ID>"，指向一个导出的组件。', component.file, child.line);
        // UI-013 ArtText
        if (child.ref?.fullName === 'Common/ArtText') {
          const m = /(?:^|;)font=([A-Z][A-Za-z0-9]*)\/([A-Za-z0-9]+)(?:;|$)/.exec(child.attrs.customData ?? '');
          const fontPkg = m && model.packages.find(p => p.name === m[1]);
          if (!m || !fontPkg || !fs.existsSync(path.join(fontPkg.dir, 'artfont', m[2]))) add('LGUI-UI-013', `组件 ${component.fullName} 的 ArtText ${child.name} 的 customData 写法不对，或者字体目录不存在。`, '写成 customData="font=<包>/<字体名>;align=center;spacing=2"，字符图片放在 <包>/artfont/<字体名>/ 下。', component.file, child.line);
        }
      }
      // UI-067 动效里旋转、缩放的控件没设轴心：默认绕左上角转、朝右下缩放
      const reported = new Set();
      for (const transition of component.root?.children.filter(n => n.tag === 'transition') ?? []) {
        const items = transition.children.filter(n => n.tag === 'item');
        for (const item of items) {
          const {type, target: id} = item.attrs;
          if (!IDENTITY[type] || !id || reported.has(id)) continue;
          const values = [item.attrs.startValue, item.attrs.endValue, item.attrs.value].filter(v => v !== undefined);
          if (values.every(IDENTITY[type])) continue;
          const target = component.children.find(c => c.id === id);
          if (!target || target.attrs.pivot !== undefined) continue;
          if (items.some(i => i.attrs.type === 'Pivot' && i.attrs.target === id)) continue;
          // 按下缩放的按钮（<Button downEffect="scale"/>）FairyGUI 自动把轴心设在中间
          if (target.ref?.root?.children.find(n => n.tag === 'Button')?.attrs.downEffect === 'scale') continue;
          reported.add(id);
          add('LGUI-UI-067', `组件 ${component.fullName} 的动效 ${transition.attrs.name} 给 ${target.name ?? id} 做了${type === 'Scale' ? '缩放' : '旋转'}，但 ${target.name ?? id} 没设轴心（pivot），会绕左上角${type === 'Scale' ? '缩放' : '转'}。`, `在 ${target.name ?? id} 上写 pivot="0.5,0.5"（绕中心）；确实要绕左上角就写 pivot="0,0"。`, component.file, lineWith(component.file, [`type="${type}"`, `target="${id}"`]));
        }
      }
      // UI-069 动效的目标是普通组：普通组只在编辑时有，生成界面包时会被去掉，动效找不到它、动不了
      const plainGroups = new Set();
      for (const transition of component.root?.children.filter(n => n.tag === 'transition') ?? []) {
        for (const item of transition.children.filter(n => n.tag === 'item')) {
          const id = item.attrs.target;
          const group = id && !plainGroups.has(id) ? component.children.find(c => c.id === id && c.tag === 'group') : null;
          if (!group || group.attrs.advanced === 'true') continue;
          plainGroups.add(id);
          add('LGUI-UI-069', `组件 ${component.fullName} 的动效 ${transition.attrs.name} 的目标是普通组 ${group.name ?? id}。普通组生成界面包时会被去掉，动效动不了它。`, `在 ${group.name ?? id} 上写 advanced="true"（高级组，生成后还在）；或者让动效直接动组里的控件。`, component.file, lineWith(component.file, ['<item', `target="${id}"`]));
        }
      }
      // UI-004、UI-005 重名（复用生成类型时的检查）
      for (const e of members(component).errors) add(e.code, e.message, e.fix, component.file, e.line);
      // UI-007 横竖两版
      if (!component.name.endsWith(PORTRAIT)) {
        const portrait = pkg.components.find(c => c.name === component.name + PORTRAIT);
        if (portrait) for (const e of comparePortrait(component, portrait, members(component).result, members(portrait).result)) add(e.code, e.message, e.fix, portrait.file, 1);
      }
    }
  }

  // UI-014 Common 包
  const common = model.packages.find(p => p.name === 'Common');
  if (!common) add('LGUI-UI-014', '工程里没有 Common 包。', '用 lgui init 生成的 Common 包，不要删。');
  else for (const [name, required] of Object.entries(COMMON)) {
    const c = findComponent(model, `Common/${name}`);
    if (!c) { add('LGUI-UI-014', `Common 包里缺少固定组件 ${name}。`, `把 Common/${name} 加回来（UI 开发规范第 10 节）。`, common.file); continue; }
    const names = new Set(c.children.map(ch => ch.name));
    for (const r of required) if (!names.has(r)) add('LGUI-UI-014', `Common/${name} 里缺少必有控件 ${r}。`, `把 ${r} 加回来，名字不能改。`, c.file);
  }

  // UI-064 全屏界面的组件（横竖两版）都有直接子控件 safe：框架把它摆进安全区，贴边的控件关联到它
  const checked = new Set();
  for (const v of fullScreens) {
    const component = findComponent(model, v.component);
    const portrait = component && findComponent(model, `${v.component}${PORTRAIT}`);
    for (const c of [component, portrait].filter(Boolean)) {
      if (checked.has(c)) continue;
      checked.add(c);
      if (!c.children.some(ch => ch.name === 'safe')) add('LGUI-UI-064', `全屏界面 ${v.component} 的组件 ${c.fullName} 里没有名为 safe 的直接子控件，界面会被刘海、圆角挡住。`, `在 displayList 里 bg 后面加一个空图形：<graph id="n…" name="safe" xy="0,0" size="${c.size}" touchable="false"><relation target="" sidePair="width-width,height-height"/></graph>；贴边、要点的控件把关联的 target 写成它的 ID（UI 开发规范第 7.3 节）。`, c.file, 1);
    }
  }

  // UI-065 工程配置里的默认点击音效
  if (sounds?.click) { const problem = soundProblem(model, sounds.click, {customAudio}); if (problem) out.push(finding('LGUI-UI-065', `工程配置 sounds.click 的音效不对：${problem}。`, '改成登记过的 mp3 音效地址（ui://包名/音效名），或者代码合成声音（synth://名字，并在 lgui.app({ platform: { audio } }) 提供自定义声音出口），或者写 null（不播）。', {file: '.lgui/project.json', line: 1, col: 1})); }

  // UI-012 绑定了 redDot 的控件里有 redDot 子控件
  for (const b of redDots) {
    const component = findComponent(model, b.component);
    if (!component) continue;
    const parts = b.key.split('.');
    let owner = component;
    for (const part of parts) {
      const child = owner?.children.find(c => c.name === part);
      owner = child?.ref ?? null;
    }
    if (!owner || !owner.children.some(c => c.name === 'redDot')) out.push(finding('LGUI-UI-012', `${b.component} 的 ${b.key} 绑定了 redDot，但它里面没有名为 redDot 的子控件。`, '在 ui/ 里给它放一个 Common/RedDot 的实例，名字叫 redDot。', b.loc));
  }
  // UI-066 绑定表给按钮、标签写了 text，给下拉框写了 items，组件里却没有 title 子控件：网页上显示不出来
  for (const b of [...texts.map(t => ({...t, word: 'text'})), ...items.map(t => ({...t, word: 'items'}))]) {
    const component = findComponent(model, b.component);
    let owner = component, child = null;
    for (const part of b.key.split('.')) {
      child = owner?.children.find(c => c.name === part) ?? null;
      owner = child?.ref ?? null;
    }
    if (child?.tag !== 'component' || !titleless(child.ref) || (b.word === 'items' && child.ref.extension !== 'ComboBox')) continue;
    out.push(finding('LGUI-UI-066', `${b.component} 的 ${b.key} 绑定了 ${b.word}，但它的${TITLED[child.ref.extension]}组件 ${child.ref.fullName} 里没有名为 title 的子控件，${shows(child.ref)}在网页上显示不出来。`, titleFix(child.ref), b.loc));
  }
  // UI-066 绑定表给按钮、标签写了 icon，组件里却没有 icon 子控件：显示不出来
  for (const b of iconBindings) {
    const component = findComponent(model, b.component);
    let owner = component, child = null;
    for (const part of b.key.split('.')) {
      child = owner?.children.find(c => c.name === part) ?? null;
      owner = child?.ref ?? null;
    }
    if (child?.tag !== 'component' || !iconless(child.ref)) continue;
    out.push(finding('LGUI-UI-066', `${b.component} 的 ${b.key} 绑定了 icon，但它的${TITLED[child.ref.extension]}组件 ${child.ref.fullName} 里没有名为 icon 的子控件，图标显示不出来。`, iconFix(child.ref), b.loc));
  }
  // UI-009 工程配置的默认占位图（ui://）：指向的图片存在且已导出；无图工程应写成 null 或 icon://
  if (typeof placeholder === 'string' && placeholder.startsWith('ui://')) {
    const found = resourceByUrl(model, placeholder);
    if (!found || found.res.type !== 'image') {
      if (common || !placeholder.startsWith('ui://Common/')) {
        out.push(finding('LGUI-UI-009', `工程配置 placeholder 指向的图片 ${placeholder} 不存在。`, '在对应的 package.xml 里登记这张图片，或者在 .lgui/project.json 里把 placeholder 改成 null（无图工程不显示占位图）。', {file: '.lgui/project.json', line: 1, col: 1}));
      }
    } else if (!found.res.exported) {
      out.push(finding('LGUI-UI-009', `工程配置 placeholder 指向的图片 ${placeholder} 没有导出。`, `在 ${found.pkg.name}/package.xml 里给它写 exported="true"，或者把 placeholder 改成 null。`, {file: '.lgui/project.json', line: 1, col: 1}));
    }
  }
  // UI-009 代码图标地址（icon://）：写法合法且在代码里已注册
  for (const entry of collectUiIconUrls(root, model, placeholder)) {
    const problem = iconUrlProblem(entry.url, codeIcons);
    if (problem) out.push(finding('LGUI-UI-009', `${entry.where}：${problem.message}。`, problem.fix, {file: entry.file, line: entry.line, col: 1}));
  }
  for (const entry of codeIcons?.urls ?? []) {
    const problem = iconUrlProblem(entry.url, codeIcons);
    if (problem) out.push(finding('LGUI-UI-009', `${problem.message}。`, problem.fix, entry.loc));
  }
  return out;
}

// 文件里同时包含这几段文字的第一行（动效的 item 没有 id，按 type 和 target 找行号）。
function lineWith(file, needles) {
  const index = fs.readFileSync(file, 'utf8').split('\n').findIndex(line => needles.every(n => line.includes(n)));
  return index >= 0 ? index + 1 : undefined;
}
