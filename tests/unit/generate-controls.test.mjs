// 由 ui/ 生成新控件的类型和 headless 描述：标签、滑动条、下拉框、序列帧动画、树的控件类型，绑定表按控件类型检查词，齿轮和组写进描述。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture} from '../helpers/fixture.mjs';
import {writeControls} from '../conformance/controls.mjs';
import {importTs, typecheck} from '../helpers/ts.mjs';
import {generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';
import {listUi} from '../../plugin/tools/lib/generate/uilist.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const lgui = path.join(repo, 'plugin/framework/index.ts');

async function project() {
  const root = writeFixture();
  writeControls(root, {buttonId: 'cbtn0001'});
  const result = await generateProjectTypes(root);
  return {root, ...result};
}

function checkBind(root, body) {
  const file = path.join(root, 'bind.ts');
  fs.writeFileSync(file, `import type { Bind } from 'lgui';\nimport type { ControlsPanelUI } from './.lgui/build/types/index';\ndeclare const ui: ControlsPanelUI;\n${body}\nexport {};\n`);
  return typecheck([file], {baseUrl: root, paths: {lgui: [lgui]}});
}

test('控件类型：Label → label、Slider → slider、ComboBox → combobox、movieclip、treeView 的列表 → tree', async () => {
  const {model} = await project();
  const controls = listUi(model).find(p => p.name === 'Controls').components.find(c => c.name === 'Controls/ControlsPanel').controls;
  const kind = Object.fromEntries(controls.map(c => [c.path, c.kind]));
  assert.deepEqual([kind.badge, kind.volume, kind.mode, kind.spin, kind.tree, kind.nameInput], ['label', 'slider', 'combobox', 'movieclip', 'tree', 'input']);
  assert.equal(kind['mode.button'], undefined, '下拉框自带的 button 控制器不进类型');
  assert.equal(kind.extra, undefined, '组不进类型');
});

test('生成的类型能用：滑动条 value / change、下拉框 items / selected / select、输入框 input、序列帧 playing、树和列表同样的词；用错词编译报错', async () => {
  const {root} = await project();
  const ok = checkBind(root, [
    'const n: number = ui.volume.value; const s: readonly string[] = ui.mode.items; const p: boolean = ui.spin.playing; const k: string | number | null = ui.tree.selectedKey;',
    "const b: Bind<ControlsPanelUI> = {",
    "  volume: { value: 1, change: v => { const x: number = v; void x; } },",
    "  mode: { items: ['a'], selected: 0, select: i => { const x: number = i; void x; } },",
    "  nameInput: { text: 'x', input: t => { const x: string = t; void x; } },",
    "  spin: { playing: true },",
    "  badge: { text: 'x', icon: 'ui://Controls/x' },",
    "  tree: { items: [], key: (n: {id: string}) => n.id, select: (id: never) => id },",
    "  view: { page: 'full' },",
    "};",
    'void b;'
  ].join('\n'));
  assert.deepEqual(ok, []);
  for (const wrong of ["volume: { progress: 1 }", "nameText: { input: () => 0 }", "mode: { value: 1 }", "spin: { text: 'x' }", "lockButton: { change: () => 0 }"]) {
    assert.ok(checkBind(root, `const b: Bind<ControlsPanelUI> = { ${wrong} };\nvoid b;`).length > 0, wrong);
  }
});

test('headless 描述：齿轮的页 ID 换成页名，组和组里的控件、gearDisplay2 的条件，新控件的初始属性', async () => {
  const {root} = await project();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/headless/Controls.json'), 'utf8'));
  const panel = pkg.components.find(c => c.name === 'Controls/ControlsPanel');
  const byName = Object.fromEntries(panel.children.map(c => [c.name, c]));
  assert.deepEqual(panel.groups, [{id: 'n14', name: 'extra', visible: true, group: null, gears: {display: {controller: 'view', pages: ['full']}}}]);
  assert.equal(byName.extraButton.group, 'n14');
  assert.deepEqual(byName.simpleText.gears, {display: {controller: 'view', pages: ['simple']}});
  assert.deepEqual(byName.lockedText.gears, {display: {controller: 'view', pages: ['full']}, display2: {controller: 'lock', pages: ['on'], condition: 0}});
  assert.deepEqual([byName.volume.props.value, byName.volume.props.max, byName.volume.props.min], [50, 100, 0]);
  assert.deepEqual([byName.badge.props.title, byName.spin.props.playing, byName.tree.props.clickToExpand, byName.tree.defaultItem], ['徽章', true, 1, 'Controls/TreeItem']);
  assert.equal(pkg.components.find(c => c.name === 'Controls/Slider').wholeNumbers, true);
});

test('包依赖：下拉框弹出的列表放在别的包里，下拉框所在的包依赖那个包（同包的不算）', async () => {
  const {packageDeps} = await import('../../plugin/tools/lib/generate/index.mjs');
  const combo = dropdown => ({extension: 'ComboBox', children: [], root: {children: [{tag: 'ComboBox', attrs: {dropdown}}]}});
  const popup = {name: 'Popup', id: 'pop00001', components: []};
  const ui = {name: 'Ui', id: 'ui000001', components: [combo('ui://pop00001cbpop001'), combo('ui://ui000001cbpop002'), combo('')]};
  const model = {packages: [ui, popup], byId: new Map([[ui.id, ui], [popup.id, popup]])};
  assert.deepEqual(packageDeps(model), {Ui: ['Popup'], Popup: []});
});

test('包依赖：图片写了别的包的 pkg（跨包图片），所在的包依赖那个包（pkg 写本包的、不写的不算）', async () => {
  const {packageDeps} = await import('../../plugin/tools/lib/generate/index.mjs');
  const image = pkg => ({tag: 'image', attrs: {...(pkg ? {pkg} : {}), src: 'img00001'}});
  const art = {name: 'Art', id: 'art00001', components: []};
  const ui = {name: 'Ui', id: 'ui000001', components: [{extension: null, children: [image('art00001'), image('ui000001'), image(null)], root: {children: []}}]};
  const model = {packages: [ui, art], byId: new Map([[ui.id, ui], [art.id, art]])};
  assert.deepEqual(packageDeps(model), {Ui: ['Art'], Art: []});
});

test('多语言：标签的固定标题、下拉框的固定选项都提取；headless 换语言时选项跟着翻译', async () => {
  const root = writeFixture();
  const dest = writeControls(root, {buttonId: 'cbtn0001'});
  const panel = path.join(dest, 'ControlsPanel.xml');
  fs.writeFileSync(panel, fs.readFileSync(panel, 'utf8').replace('<component id="n5" name="mode" src="combo001" xy="60,240" size="300,60"/>',
    '<component id="n5" name="mode" src="combo001" xy="60,240" size="300,60"><ComboBox title="中"><item title="低"/><item title="中"/></ComboBox></component>'));
  const {extractTexts} = await import('../../plugin/tools/lib/generate/i18n.mjs');
  const {readUiModel} = await import('../../plugin/tools/lib/generate/model.mjs');
  const entries = Object.fromEntries(extractTexts(readUiModel(path.join(root, 'ui', 'UI.fairy'))).map(e => [e.key, e]));
  assert.deepEqual(entries['Controls/ControlsPanel/badge'] && {text: entries['Controls/ControlsPanel/badge'].text, targets: entries['Controls/ControlsPanel/badge'].targets.map(t => t.name.slice(-3))}, {text: '徽章', targets: ['-n7']});
  assert.equal(entries['Controls/ControlsPanel/mode@item0'].text, '低');
  assert.deepEqual(entries['Controls/ControlsPanel/mode@item1'].targets.map(t => t.name.replace(/^.*-n5/, 'n5')), ['n5-1', 'n5'], '选中项的标题跟着那一项翻译');
  // headless：第 j 项按「<元素ID>-<j>」翻译（和 FairyGUI 一样），选中的还是同一项
  await generateProjectTypes(root);
  const dir = path.join(root, '.lgui/build/headless');
  const packages = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const {createHeadlessBackend} = await importTs(path.join(repo, 'plugin/framework/backends/headless/index.ts'));
  const [low, mid] = entries['Controls/ControlsPanel/mode@item0'].targets.concat(entries['Controls/ControlsPanel/mode@item1'].targets).map(t => t.name);
  const backend = createHeadlessBackend(packages, {en: {[low]: 'Low', [mid]: 'Medium'}});
  await backend.init({projectName: 'i18n', defaultFont: null, uiBase: 'ui'});
  await backend.loadPackage('Common'); await backend.loadPackage('Controls');
  await backend.setLanguage('en');
  const mode = backend.create('Controls', 'ControlsPanel').child('mode');
  assert.deepEqual([mode.items, mode.selectedIndex], [['Low', 'Medium'], 1]);
});
