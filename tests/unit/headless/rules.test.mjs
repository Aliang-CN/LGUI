// headless 照浏览器里 FairyGUI 的规则执行：虚拟列表要能滚动、按钮和标签的文字写进 title 子控件、Check / Radio 点了切换选中、
// 打字遵守 maxLength；布局算出来的位置和尺寸（关联、列表和组的排布、文字自动大小、gearXY）记下原因，测试读到时报 LGUI-RT-260。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importTs} from '../../helpers/ts.mjs';
import {writeFixture} from '../../helpers/fixture.mjs';
import {generateProjectTypes} from '../../../plugin/tools/lib/generate/index.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const dir = path.join(repo, 'plugin/framework/backends/headless');
const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;

// Rules 包：一个界面放齐要测的控件。
function writeRules(root) {
  const pkg = path.join(root, 'ui/assets/Rules');
  fs.mkdirSync(pkg, {recursive: true});
  const button = (mode, children) => xml(`<component size="100,60" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="100,60" type="rect" fillColor="#334455"/>
    ${children}
  </displayList>
  <Button${mode ? ` mode="${mode}"` : ''}/>
</component>`);
  const files = {
    'package.xml': xml(`<packageDescription id="rules001">
  <resources>
    <component id="panel001" name="RulesPanel.xml" path="/" exported="true"/>
    <component id="item0001" name="Item.xml" path="/"/>
    <component id="notitle1" name="NoTitle.xml" path="/"/>
    <component id="titled01" name="Titled.xml" path="/"/>
    <component id="frame001" name="Frame.xml" path="/"/>
    <component id="check001" name="Check.xml" path="/"/>
    <component id="radio001" name="Radio.xml" path="/"/>
  </resources>
</packageDescription>`),
    'RulesPanel.xml': xml(`<component size="1000,800">
  <displayList>
    <list id="n1" name="fixed" xy="0,0" size="400,60" layout="row" defaultItem="ui://rules001item0001"/>
    <list id="n2" name="scroller" xy="0,100" size="400,300" defaultItem="ui://rules001item0001" overflow="scroll"/>
    <component id="n3" name="noTitle" src="notitle1" xy="0,400" size="200,60"><Button title="欢迎"/></component>
    <component id="n4" name="titled" src="titled01" xy="0,500" size="200,60"/>
    <component id="n5" name="frame" src="frame001" xy="0,600" size="200,60"><Label title="标题"/></component>
    <component id="n6" name="check" src="check001" xy="300,0" size="100,60"/>
    <component id="n7" name="radio" src="radio001" xy="300,100" size="100,60"/>
    <inputtext id="n8" name="name" xy="300,200" size="300,60" fontSize="24" autoSize="none" singleLine="true" maxLength="4" text=""/>
    <text id="n9" name="auto" xy="300,300" size="200,40" fontSize="24" text="自动"/>
    <text id="n10" name="fixedText" xy="300,350" size="200,40" fontSize="24" autoSize="none" text="定"/>
    <graph id="n11" name="moved" xy="10,20" size="30,40" type="rect"><relation target="" sidePair="right-right"/></graph>
    <graph id="n12" name="stretched" xy="10,20" size="30,40" type="rect"><relation target="" sidePair="width-width"/></graph>
    <group id="n13" name="row" xy="600,0" size="200,60" advanced="true" layout="hz"/>
    <graph id="n14" name="inRow" xy="600,0" size="50,50" type="rect" group="n13"/>
  </displayList>
</component>`),
    'Item.xml': xml(`<component size="100,60">
  <displayList>
    <text id="n1" name="title" xy="0,0" size="100,60" fontSize="24" autoSize="none" text=""/>
  </displayList>
</component>`),
    'NoTitle.xml': button(null, '<text id="n1" name="text" xy="0,0" size="100,60" fontSize="24" autoSize="none" text=""/>'),
    'Titled.xml': button(null, '<text id="n1" name="title" xy="0,0" size="100,60" fontSize="24" autoSize="none" text="确定"/>'),
    'Frame.xml': xml(`<component size="200,60" extention="Label">
  <displayList>
    <text id="n1" name="title" xy="0,0" size="200,60" fontSize="24" autoSize="none" text="默认"/>
  </displayList>
  <Label/>
</component>`),
    'Check.xml': button('Check', ''),
    'Radio.xml': button('Radio', '')
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(pkg, name), text);
}

async function setup() {
  const root = writeFixture();
  writeRules(root);
  await generateProjectTypes(root);
  const packages = fs.readdirSync(path.join(root, '.lgui/build/headless')).map(f => JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/headless', f), 'utf8')));
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(dir, 'index.ts'))};\nexport * as sim from ${JSON.stringify(path.join(dir, 'simulate.ts'))};`);
  const mod = await importTs(entry);
  const backend = mod.createHeadlessBackend(packages);
  await backend.init({projectName: 'demo', defaultFont: null, uiBase: ''});
  await backend.loadPackage('Rules');
  const panel = backend.create('Rules', 'RulesPanel');
  backend.root.addChild(panel);
  return {backend, panel, sim: mod.sim};
}

test('虚拟列表：和浏览器一样，只有能滚动（overflow="scroll"）的列表能设成虚拟列表，设了不能改回去；不能滚动的列表滚动位置总是 0', async () => {
  const {panel} = await setup();
  const fixed = panel.child('fixed'), scroller = panel.child('scroller');
  assert.deepEqual([fixed.scrollable, scroller.scrollable], [false, true]);
  assert.throws(() => { fixed.virtual = true; }, e => e.code === 'LGUI-RT-261' && /overflow="scroll"/.test(e.message));
  assert.equal(fixed.virtual, false);
  scroller.virtual = true;
  assert.throws(() => { scroller.virtual = false; }, e => e.code === 'LGUI-RT-021');
  fixed.scrollPosition = {x: 0, y: 50};
  scroller.scrollPosition = {x: 0, y: 50};
  assert.deepEqual([fixed.scrollPosition, scroller.scrollPosition], [{x: 0, y: 0}, {x: 0, y: 50}]);
});

test('按钮的文字：和 FairyGUI 一样记一份并写进 title 子控件；实例没写 title 时是 title 子控件自己的文字', async () => {
  const {panel} = await setup();
  const noTitle = panel.child('noTitle'), titled = panel.child('titled');
  assert.deepEqual([noTitle.title, noTitle.childNames().includes('title')], ['欢迎', false], '没有 title 子控件：读得到，但不显示');
  assert.deepEqual([titled.title, titled.child('title').text], ['确定', '确定']);
  titled.title = '好的';
  assert.equal(titled.child('title').text, '好的');
});

test('标签的文字就是 title 子控件的文字（浏览器里一样）', async () => {
  const {panel} = await setup();
  const frame = panel.child('frame');
  assert.deepEqual([frame.title, frame.child('title').text], ['标题', '标题']);
  frame.title = '换了';
  assert.equal(frame.child('title').text, '换了');
});

test('点 Check 按钮切换选中，点 Radio 按钮只会选中（和 FairyGUI 一样）', async () => {
  const {backend, panel, sim} = await setup();
  const check = panel.child('check'), radio = panel.child('radio');
  await sim.click(backend, check);
  assert.deepEqual([check.selected, check.controller('button').selectedPage], [true, 'down']);
  await sim.click(backend, check);
  assert.deepEqual([check.selected, check.controller('button').selectedPage], [false, 'up']);
  await sim.click(backend, radio);
  await sim.click(backend, radio);
  assert.equal(radio.selected, true);
});

test('打字遵守 maxLength（UTF-16 长度，和浏览器的 maxlength 一样）：满了以后再打的字进不去，也不通知；代码写 text 不截断', async () => {
  const {backend, panel, sim} = await setup();
  const input = panel.child('name');
  const seen = [];
  input.onChange(text => seen.push(text));
  await sim.type(backend, input, '一二三四五六');
  assert.deepEqual([input.text, seen], ['一二三四', ['一', '一二', '一二三', '一二三四']]);
  await sim.type(backend, input, '😀😀😀');
  assert.equal(input.text, '😀😀', '一个表情占 2');
  input.text = '代码写的可以更长';
  assert.equal(input.text, '代码写的可以更长');
});

test('布局算出来的位置、尺寸记下原因：关联、文字自动大小、组的排布、列表的排布；框架写 rect 以后就是框架算的', async () => {
  const {panel} = await setup();
  const unknown = name => panel.child(name).unknownLayout;
  assert.deepEqual(unknown('moved'), {position: '关联（relation right-right）', size: null});
  assert.deepEqual(unknown('stretched'), {position: null, size: '关联（relation width-width）'});
  assert.deepEqual(unknown('auto'), {position: null, size: '文字的自动大小（autoSize="both"）'});
  assert.deepEqual(unknown('fixedText'), {position: null, size: null});
  assert.deepEqual(unknown('inRow'), {position: '组 row 的排布（layout="hz"）', size: null});
  const list = panel.child('scroller');
  list.numItems = 2;
  assert.equal(list.itemAt(1).unknownLayout.position, '列表的排布');
  const moved = panel.child('moved');
  assert.deepEqual(moved.rect, {x: 10, y: 20, width: 30, height: 40}, '内部读 rect 照常返回 ui/ 里的值（框架自己用）');
  moved.rect = {x: 1, y: 2, width: 3, height: 4};
  assert.deepEqual(moved.unknownLayout, {position: null, size: null});
});
