// 输入路由、输入类型、inputMode、返回键、按键动作、操作提示栏。
import test from 'node:test';
import assert from 'node:assert/strict';
import {started} from '../../helpers/framework.mjs';

async function setup() {
  const ctx = await started();
  const {fw} = ctx;
  fw.setTexts({'zh-CN': {'lgui.back': '返回', 'bag.sell': '出售'}}, 'zh-CN');
  fw.inputType.set('keyboardMouse');
  const log = [];
  const {View} = fw;
  class MainView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; bind = {sellButton: {click: () => log.push('page click')}, gold: {visibleOn: ['keyboardMouse']}}; }
  class DetailView extends View { static component = 'Bag/ItemSlot'; static layer = 'popup'; keys = {confirm: {do: () => log.push('confirm'), hint: 'bag.sell'}}; }
  class LockedView extends View { static component = 'Bag/Header'; static layer = 'popup'; keys = {back: 'none'}; }
  class CustomBack extends View { static component = 'Bag/Header'; static layer = 'popup'; keys = {back: () => log.push('custom back')}; }
  class RewardView extends View { static component = 'Common/CurrencyBar'; static layer = 'modal'; keys = {confirm: {do: () => log.push('reward confirm')}}; }
  class HudView extends View { static component = 'Bag/Header'; static layer = 'hud'; }
  const hints = () => {
    const toast = ctx.backend.root.children.find(c => c.name === 'toast');
    const component = toast.children[0];
    const list = component.child('list');
    return {visible: component.visible, items: Array.from({length: list.numItems}, (_, i) => `${list.itemAt(i).child('key').text} ${list.itemAt(i).child('label').text}`)};
  };
  return {...ctx, log, hints, views: {MainView, DetailView, LockedView, CustomBack, RewardView, HudView}};
}

test('modal 打开时，下面的按钮点不到、按键也只送给 modal', async () => {
  const {fw, backend, sim, log, views: {MainView, RewardView}} = await setup();
  const {lgui} = fw;
  const main = await lgui.ui.open(MainView);
  await lgui.ui.open(RewardView);
  await assert.rejects(sim.click(backend, main.__component.child('sellButton')), e => e.code === 'LGUI-RT-032');
  await sim.key(backend, 'Enter');
  assert.deepEqual(log, ['reward confirm']);
});

test('输入类型：用触摸操作后 visibleOn: keyboardMouse 的控件隐藏；按键后恢复；发出 inputTypeChange', async () => {
  const {fw, backend, sim, views: {MainView}} = await setup();
  const {lgui} = fw;
  const types = [];
  fw.bus.on(lgui.events.inputTypeChange, e => types.push(e.inputType));
  const main = await lgui.ui.open(MainView);
  await sim.click(backend, main.__component.child('sellButton'), 50, 'touch');
  assert.equal(main.__component.child('gold').visible, false);
  await sim.key(backend, 'x');
  assert.equal(main.__component.child('gold').visible, true);
  assert.deepEqual(types, ['touch', 'keyboardMouse']);
});

test('inputMode：hud 默认 game，其余 ui；激活界面一变就通知游戏场景；关掉全部界面后回到 game', async () => {
  const {fw, backend, views: {HudView, MainView}} = await setup();
  const {lgui} = fw;
  const modes = [];
  fw.bus.on(lgui.events.inputModeChange, e => modes.push(e.inputMode));
  await lgui.ui.open(HudView);
  assert.equal(backend.state.inputMode, 'game');
  await lgui.ui.open(MainView);
  assert.deepEqual([backend.state.inputMode, modes], ['ui', ['game', 'ui']]);
  lgui.ui.close(MainView);
  lgui.ui.close(HudView);
  assert.deepEqual([backend.state.inputMode, modes], ['game', ['game', 'ui', 'game']]);
});

test('返回键：Esc 和安卓返回键关闭激活的界面；back: none 不关；函数就调用它；主界面关不掉', async () => {
  const {fw, backend, sim, log, views: {MainView, DetailView, LockedView, CustomBack}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView);
  await sim.key(backend, 'Escape');
  assert.equal(lgui.ui.isOpen(DetailView), false);
  await lgui.ui.open(LockedView);
  await sim.key(backend, 'Back');
  assert.equal(lgui.ui.isOpen(LockedView), true);
  lgui.ui.close(LockedView);
  await lgui.ui.open(CustomBack);
  await sim.key(backend, 'Escape');
  assert.deepEqual([lgui.ui.isOpen(CustomBack), log], [true, ['custom back']]);
  lgui.ui.close(CustomBack);
  await sim.key(backend, 'Escape');
  assert.equal(lgui.ui.isOpen(MainView), true);
});

test('按键动作 { do, hint }：Enter → confirm 调用 do', async () => {
  const {fw, backend, sim, log, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView);
  await sim.key(backend, 'Enter');
  assert.deepEqual(log, ['confirm']);
});

test('操作提示栏：内容跟着激活界面变；返回键默认显示「返回」；触屏上隐藏', async () => {
  const {fw, backend, sim, hints, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  const main = await lgui.ui.open(MainView);
  assert.deepEqual(hints().items, [], '主界面返回不了，没有提示');
  await lgui.ui.open(DetailView);
  assert.deepEqual(hints(), {visible: true, items: ['Esc 返回', 'Enter 出售']});
  lgui.ui.close(DetailView);
  assert.deepEqual(hints().items, []);
  await lgui.ui.open(DetailView);
  await sim.click(backend, lgui.ui.get(DetailView).__component.child('icon'), 50, 'touch');
  assert.equal(hints().visible, false);
  void main;
});
