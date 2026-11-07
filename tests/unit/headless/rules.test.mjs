// headless 照浏览器里 FairyGUI 的规则执行：虚拟列表要能滚动、按钮和标签的文字写进 title 子控件、Check / Radio 点了切换选中、
// 打字遵守 maxLength；布局算出来的位置和尺寸（关联、列表和组的排布、文字和加载器的自动大小、gearXY / gearSize）记下原因，测试读到时报 LGUI-RT-260；
// 改属性的齿轮（gearText、gearColor、gearIcon、gearLook）不模拟，读到它们管的属性时报 LGUI-RT-260。
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
    <component id="gtitle01" name="GearTitle.xml" path="/"/>
  </resources>
</packageDescription>`),
    'RulesPanel.xml': xml(`<component size="1000,800">
  <controller name="state" pages="0,a,1,b" selected="0"/>
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
    <text id="n15" name="geared" xy="0,700" size="200,40" fontSize="24" autoSize="none" text="甲"><gearText controller="state" pages="1" values="乙" default="甲"/></text>
    <graph id="n16" name="tinted" xy="300,700" size="50,50" type="rect" fillColor="#ff0000"><gearColor controller="state" pages="1" values="#00ff00" default="#ff0000"/></graph>
    <loader id="n17" name="pic" xy="400,700" size="100,100" autoSize="true"/>
    <loader id="n18" name="iconLoader" xy="500,700" size="100,100"><gearIcon controller="state" pages="1" values="" default=""/></loader>
    <component id="n19" name="lookBtn" src="titled01" xy="600,700" size="200,60"><gearLook controller="state" pages="1" values="1,0,1,0" default="1,0,0,1"/></component>
    <component id="n20" name="gearTitle" src="gtitle01" xy="600,600" size="200,60"/>
    <component id="n21" name="gearFrame" src="frame001" xy="600,500" size="200,60"><gearText controller="state" pages="1" values="乙" default="甲"/><Label title="标题"/></component>
    <component id="n22" name="noGear" src="titled01" xy="600,400" size="200,60"><Button title="照常"/></component>
    <group id="n23" name="mover" xy="800,0" size="50,50" advanced="true"><gearXY controller="state" pages="1" values="10,10" default="800,0"/></group>
    <graph id="n24" name="inMover" xy="800,0" size="50,50" type="rect" group="n23"/>
    <group id="n25" name="sizer" xy="800,100" size="100,50" advanced="true" layout="hz"><gearSize controller="state" pages="1" values="200,50,1,1" default="100,50,1,1"/></group>
    <graph id="n26" name="inSizer" xy="800,100" size="50,50" type="rect" group="n25"/>
    <group id="n27" name="plainSizer" xy="800,200" size="100,50" advanced="true"><gearSize controller="state" pages="1" values="200,50,1,1" default="100,50,1,1"/></group>
    <graph id="n28" name="inPlain" xy="800,200" size="50,50" type="rect" group="n27"/>
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
    // 按钮的 title 子控件自己有 gearText（跟按钮组件里的控制器 c）
    'GearTitle.xml': xml(`<component size="200,60" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <controller name="c" pages="0,x,1,y" selected="0"/>
  <displayList>
    <text id="n1" name="title" xy="0,0" size="200,60" fontSize="24" autoSize="none" text="原来"><gearText controller="c" pages="1" values="换了" default="原来"/></text>
  </displayList>
  <Button/>
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

test('改属性的齿轮（gearText、gearColor、gearIcon、gearLook）不模拟：读到它管的属性报 LGUI-RT-260；代码写过就知道，这个控制器换页又不知道', async () => {
  const {backend, panel, sim} = await setup();
  const unsupported = (where, what, gear) => e => e.code === 'LGUI-RT-260' && e.message.includes(`${where} 的${what}`) && e.message.includes(gear) && e.message.includes('lgui test --browser');
  const geared = panel.child('geared');
  assert.throws(() => geared.text, unsupported('Rules/RulesPanel.geared', '文字', 'gearText（控制器 state）'));
  geared.text = '代码写的';
  assert.equal(geared.text, '代码写的', '写过以后知道');
  panel.controller('state').selectedPage = 'b';
  assert.throws(() => geared.text, /LGUI-RT-260/, '控制器换页又不知道');
  assert.throws(() => panel.child('tinted').color, unsupported('Rules/RulesPanel.tinted', '颜色', 'gearColor（控制器 state）'));
  assert.throws(() => panel.child('iconLoader').url, unsupported('Rules/RulesPanel.iconLoader', '地址（图标）', 'gearIcon（控制器 state）'));
  // gearLook 管可用和能不能点：读 enabled、点它都报（headless 不知道它现在能不能点）
  const look = panel.child('lookBtn');
  assert.throws(() => look.enabled, unsupported('Rules/RulesPanel.lookBtn', '可用状态', 'gearLook（控制器 state）'));
  await assert.rejects(sim.click(backend, look), /LGUI-RT-260/);
  look.enabled = true;
  await sim.click(backend, look);
  // 标签自己的 gearText 改的就是 title；按钮的 title 子控件有 gearText 而实例没写 title：按钮记下的文字也不知道
  assert.throws(() => panel.child('gearFrame').title, unsupported('Rules/RulesPanel.gearFrame', '文字', 'gearText（控制器 state）'));
  assert.throws(() => panel.child('gearTitle').title, unsupported('Rules/RulesPanel.gearTitle', '文字', 'title 子控件上的改属性的齿轮 gearText（控制器 c）'));
  // 没有这些齿轮的照常读
  assert.deepEqual([panel.child('fixedText').text, panel.child('noGear').title, panel.child('noGear').enabled, panel.child('moved').color], ['定', '照常', true, '#ffffff']);
});

test('加载器的自动大小、组上的 gearXY / gearSize 也记下原因（和 FairyGUI 一样，gearSize 只有带排布的组才改组里控件的尺寸）', async () => {
  const {panel} = await setup();
  const unknown = name => panel.child(name).unknownLayout;
  assert.deepEqual(unknown('pic'), {position: null, size: '加载器的自动大小（autoSize="true"，尺寸跟着图片）'});
  assert.deepEqual(unknown('iconLoader'), {position: null, size: null});
  assert.deepEqual(unknown('inMover'), {position: '组 mover 上改位置的齿轮（gearXY）', size: null});
  assert.deepEqual(unknown('inSizer'), {position: '组 sizer 的排布（layout="hz"）', size: '组 sizer 上改尺寸的齿轮（gearSize，组的排布 layout="hz"）'});
  assert.deepEqual(unknown('inPlain'), {position: null, size: null});
});
