// 绑定缺口：单独的 Check / Radio 按钮绑 selected；列表子项里的按钮点击带上这一项的数据；ItemView 的红点按这一项算；
// 按钮、标签的类型上能写 view。用 headless 后端和生成的类型测。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {headless} from '../../helpers/framework.mjs';
import {bagPanel, writeFixture} from '../../helpers/fixture.mjs';
import {typecheck} from '../../helpers/ts.mjs';
import {generateProjectTypes} from '../../../plugin/tools/lib/generate/index.mjs';

const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;
const toggle = mode => xml(`<component size="120,48" extention="Button">
  <controller name="button" pages="0,up,1,down" selected="0"/>
  <displayList>
    <text id="n0" name="title" xy="0,0" size="120,48" fontSize="20" autoSize="shrink" singleLine="true" text=""/>
  </displayList>
  <Button mode="${mode}"/>
</component>`);

// Bag 包加上：Check 按钮（muteToggle）、两个 Radio 按钮（tabA、tabB）；格子里加一个带红点的领取按钮（claim）。
function fixture() {
  const extra = [
    '<component id="n20" name="muteToggle" src="tglchk01" xy="0,800" size="120,48"/>',
    '<component id="n21" name="tabA" src="tglrad01" xy="200,800" size="120,48"/>',
    '<component id="n22" name="tabB" src="tglrad01" xy="400,800" size="120,48"/>'
  ].join('\n    ');
  const root = writeFixture(undefined, {landscape: bagPanel({extra}), portrait: bagPanel({size: '1080,1920', extra})});
  const bag = path.join(root, 'ui', 'assets', 'Bag');
  const pkg = path.join(bag, 'package.xml');
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('<resources>', '<resources>\n    <component id="tglchk01" name="CheckToggle.xml" path="/"/>\n    <component id="tglrad01" name="RadioToggle.xml" path="/"/>'));
  fs.writeFileSync(path.join(bag, 'CheckToggle.xml'), toggle('Check'));
  fs.writeFileSync(path.join(bag, 'RadioToggle.xml'), toggle('Radio'));
  fs.writeFileSync(path.join(bag, 'ItemSlot.xml'), xml(`<component size="128,128">
  <displayList>
    <loader id="n0" name="icon" xy="0,0" size="128,128"/>
    <text id="n1" name="count" xy="80,100" size="48,28" fontSize="20" autoSize="shrink" singleLine="true" text="1"/>
    <component id="n2" name="claim" src="btn00001" xy="0,90" size="80,36"><Button title="领取"/></component>
  </displayList>
</component>`));
  return root;
}

async function setup() {
  const root = fixture();
  const ctx = await headless({root});
  await ctx.backend.loadPackage('Common');
  await ctx.backend.loadPackage('Bag');
  const panel = ctx.backend.create('Bag', 'BagPanel');
  ctx.backend.root.addChild(panel);
  const mount = bind => {
    class BagView extends ctx.fw.View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = bind; }
    const view = new BagView();
    view.__mount(panel);
    return view;
  };
  return {...ctx, root, panel, sim: ctx.fw.sim, mount};
}

test('Check 按钮：selected 显示 Model 的值，点击交给 Controller 改；重新打开（重新绑定）还是 Model 的值', async () => {
  const {fw, panel, backend, sim, mount} = await setup();
  const {lgui, pick} = fw;
  const sound = lgui.Model({muted: true});
  const toggleMuted = () => sound.set({muted: !sound.get().muted});
  const view = mount({muteToggle: {selected: pick(sound, s => s.muted), click: toggleMuted}});
  const button = panel.child('muteToggle');
  assert.equal(button.selected, true);
  await sim.click(backend, button);
  await sim.advance(backend, 16);   // FairyGUI（和跟它对齐的 headless）点完自己切换一次，下一帧按 Model 写回
  assert.deepEqual([sound.get().muted, button.selected], [false, false]);
  view.__dispose();
  mount({muteToggle: {selected: pick(sound, s => s.muted), click: toggleMuted}});
  assert.equal(button.selected, false, '重新绑定后显示 Model 的值');
});

test('Check 按钮：FairyGUI 点击时自己切换了选中，下一帧写回 Model 的值（Controller 不改时保持原样）', async () => {
  const {fw, panel, backend, sim, mount} = await setup();
  const {lgui, pick} = fw;
  const sound = lgui.Model({muted: false});
  mount({muteToggle: {selected: pick(sound, s => s.muted), click: () => {}}});
  const button = panel.child('muteToggle');
  await sim.click(backend, button);
  // 浏览器里 FairyGUI 在框架的点击处理之后自己把它切成选中（headless 跟不跟着切都一样，这里直接摆成切过的样子）。
  button.selected = true;
  await sim.advance(backend, 16);
  assert.equal(button.selected, false, '下一帧写回 Model 的值');
});

test('Radio 按钮：当前页签选中，点别的页签由 Controller 换 Model，旧的取消选中', async () => {
  const {fw, panel, backend, sim, mount} = await setup();
  const {lgui, pick} = fw;
  const tabs = lgui.Model({tab: 'a'});
  mount({
    tabA: {selected: pick(tabs, s => s.tab === 'a'), click: () => tabs.set({tab: 'a'})},
    tabB: {selected: pick(tabs, s => s.tab === 'b'), click: () => tabs.set({tab: 'b'})}
  });
  assert.deepEqual([panel.child('tabA').selected, panel.child('tabB').selected], [true, false]);
  await sim.click(backend, panel.child('tabB'));
  await sim.advance(backend, 16);
  assert.deepEqual([tabs.get().tab, panel.child('tabA').selected, panel.child('tabB').selected], ['b', false, true]);
});

test('selected 绑在普通按钮（Common 模式）上报 LGUI-RT-242（绑定时就报）；按钮上写列表的词报 LGUI-RT-063', async () => {
  const {fw, mount} = await setup();
  assert.throws(() => mount({sellButton: {selected: true}}), e => e.code === 'LGUI-RT-242' && /Check/.test(e.next));
  // 初值是 false 也在绑定时就报，不等值第一次变成 true。
  assert.throws(() => mount({sellButton: {selected: false}}), e => e.code === 'LGUI-RT-242' && /Common/.test(e.message));
  const off = fw.lgui.Model({on: false});
  assert.throws(() => mount({sellButton: {selected: fw.pick(off, s => s.on)}}), e => e.code === 'LGUI-RT-242');
  assert.throws(() => mount({muteToggle: {items: []}}), e => e.code === 'LGUI-RT-063' && /items/.test(e.message));
});

test('ItemView：子项里按钮的 click、doubleClick、hold 参数是这一项的数据；数据换了跟着换', async () => {
  const {fw, panel, backend, sim, mount} = await setup();
  const {lgui, ItemView, pick} = fw;
  const shop = lgui.Model({items: [{id: 'a'}, {id: 'b'}]});
  const log = [];
  class SlotView extends ItemView {
    static component = 'Bag/ItemSlot';
    bind = {claim: {click: it => log.push(`click ${it.id}`), doubleClick: it => log.push(`double ${it.id}`), hold: {ms: 300, action: it => log.push(`hold ${it.id}`)}}};
  }
  mount({list: {items: pick(shop, s => s.items), item: SlotView, key: it => it.id}});
  const claim = i => panel.child('list').itemAt(i).child('claim');
  await sim.click(backend, claim(1));
  await sim.advance(backend, 400);
  await sim.doubleClick(backend, claim(0));
  await sim.advance(backend, 400);
  await sim.hold(backend, claim(1), 400);
  shop.set({items: [{id: 'c'}, {id: 'b'}]});
  await sim.click(backend, claim(0));
  await sim.advance(backend, 400);
  assert.deepEqual(log.filter(x => !x.startsWith('click a')), ['click b', 'double a', 'hold b', 'click c']);
});

test('ItemView：redDot 写成函数，每一项看自己的红点路径；路径和红点变了都跟着变', async () => {
  const {fw, panel, mount} = await setup();
  const {lgui, ItemView, pick, clearRedDots} = fw;
  clearRedDots();
  const sign = lgui.Model({days: [{day: 1}, {day: 2}]});
  class DayView extends ItemView { static component = 'Bag/ItemSlot'; bind = {claim: {redDot: it => `sign.day${it.day}`}}; }
  mount({list: {items: pick(sign, s => s.days), item: DayView, key: it => it.day}});
  const dot = i => panel.child('list').itemAt(i).child('claim').child('redDot').visible;
  assert.deepEqual([dot(0), dot(1)], [false, false]);
  lgui.redDot.set('sign.day2', true);
  assert.deepEqual([dot(0), dot(1)], [false, true]);
  sign.set({days: [{day: 2}, {day: 3}]});
  assert.deepEqual([dot(0), dot(1)], [true, false], '换了数据，按新的一项的路径显示');
  lgui.redDot.set('sign.day3', 2);
  assert.deepEqual([dot(0), dot(1), panel.child('list').itemAt(1).child('claim').child('redDot').child('count').text], [true, true, '2']);
  clearRedDots();
});

const lgui = fileURLToPath(new URL('../../../plugin/framework/index.ts', import.meta.url));

function checkTypes(root, body) {
  const file = path.join(root, 'gaps.ts');
  fs.writeFileSync(file, `import type { Bind, ItemBind, PartView } from 'lgui';\nimport type { BagPanelUI, ItemSlotUI } from './.lgui/build/types/index';\ndeclare const PartClass: { new (): PartView<unknown>; component: string };\n${body}\nexport {};\n`);
  return typecheck([file], {baseUrl: root, paths: {lgui: [lgui]}});
}

test('类型：按钮能写 selected 和 view，ItemView 的 click 收到这一项的数据，redDot 能写成函数', async () => {
  const root = fixture();
  await generateProjectTypes(root);
  const ok = checkTypes(root, [
    "declare const muted: import('lgui').Picked<boolean>;",
    'const b: Bind<BagPanelUI> = { muteToggle: { selected: muted, click: () => 0 }, sellButton: { view: PartClass }, topBar: { view: PartClass } };',
    'interface Day { day: number; id: string }',
    "const i: ItemBind<ItemSlotUI, Day> = { claim: { click: it => it.id, doubleClick: it => it.day, hold: { ms: 300, action: it => it.id }, redDot: it => `sign.day${it.day}`, selected: it => it.day > 1 }, count: { text: it => String(it.day) } };",
    'void b; void i;'
  ].join('\n'));
  assert.deepEqual(ok, []);
  for (const wrong of [
    "const i: ItemBind<ItemSlotUI, {id: string}> = { claim: { click: (it: number) => it } }; void i;",
    "const i: ItemBind<ItemSlotUI, {id: string}> = { claim: { redDot: it => it.nope } }; void i;",
    "const b: Bind<BagPanelUI> = { gold: { selected: true } }; void b;"
  ]) assert.ok(checkTypes(root, wrong).length > 0, wrong);
});

// 列表虚拟化的规则（各个后端一致）：能滚动的列表（ui/ 里 overflow="scroll"）用虚拟列表，不滚动的列表按普通列表。
// 后端怎么判断能不能滚动由各自的 UIList.scrollable 决定，这里只测绑定按它走。
test('列表：能滚动的才开虚拟列表，不滚动的固定几项按普通列表（不开、不报错）', async () => {
  const {fw, panel, mount} = await setup();
  const {ItemView} = fw;
  class SlotView extends ItemView { static component = 'Bag/ItemSlot'; bind = {}; }
  const list = panel.child('list');
  const virtualCalls = [];
  const watchVirtual = scrollable => {
    let virtual = false;
    Object.defineProperty(list, 'scrollable', {configurable: true, get: () => scrollable});
    Object.defineProperty(list, 'virtual', {configurable: true, get: () => virtual, set: v => { if (!scrollable) throw new Error('Virtual list must be scrollable!'); virtualCalls.push(v); virtual = v; }});
  };
  watchVirtual(false);
  const fixed = mount({list: {items: [{id: 'a'}, {id: 'b'}, {id: 'c'}], item: SlotView}});
  assert.deepEqual([virtualCalls, list.virtual, list.numItems], [[], false, 3], '不滚动：不开虚拟列表');
  fixed.__dispose();
  watchVirtual(true);
  mount({list: {items: [{id: 'a'}], item: SlotView}});
  assert.deepEqual([virtualCalls, list.virtual], [[true], true], '能滚动：开虚拟列表');
});

test('headless：列表能不能滚动按 ui/ 里的 overflow；绑定后能滚动的是虚拟列表，不滚动的不是', async () => {
  const {fw, backend, root, panel, mount} = await setup();
  const {ItemView, View} = fw;
  const bag = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/headless/Bag.json'), 'utf8'));
  const common = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/headless/Common.json'), 'utf8'));
  const listOf = (pkg, component) => pkg.components.find(c => c.name === component).children.find(c => c.name === 'list');
  assert.deepEqual([listOf(bag, 'Bag/BagPanel').props.scrollable, listOf(common, 'Common/ActionHintBar').props.scrollable], [true, false], '描述里带上 scrollable');
  class SlotView extends ItemView { static component = 'Bag/ItemSlot'; bind = {}; }
  mount({list: {items: [{id: 'a'}], item: SlotView}});
  assert.deepEqual([panel.child('list').scrollable, panel.child('list').virtual], [true, true], 'overflow="scroll"：虚拟列表');
  const bar = backend.create('Common', 'ActionHintBar');
  class HintView extends ItemView { static component = 'Common/ActionHint'; bind = {}; }
  class BarView extends View { static component = 'Common/ActionHintBar'; static layer = 'toast'; bind = {list: {items: [{id: 'a'}, {id: 'b'}], item: HintView}}; }
  new BarView().__mount(bar);
  assert.deepEqual([bar.child('list').scrollable, bar.child('list').virtual, bar.child('list').numItems], [false, false, 2], '没写 overflow：普通列表，每一项都创建');
});
