import test from 'node:test';
import assert from 'node:assert/strict';
import {started} from '../../helpers/framework.mjs';
import {writeFixture} from '../../helpers/fixture.mjs';

test('红点：设 bag.newItem = 3 → bag 显示 3；设 false → 两个都熄灭；上层汇总下层', async () => {
  const {fw} = await started();
  const {lgui, View} = fw;
  fw.clearRedDots();
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; bind = {sellButton: {redDot: 'bag'}}; }
  const view = await lgui.ui.open(BagView);
  const dot = view.__component.child('sellButton.redDot');
  assert.equal(dot.visible, false);
  lgui.redDot.set('bag.newItem', 3);
  assert.deepEqual([lgui.redDot.get('bag'), lgui.redDot.get('bag.newItem'), dot.visible, dot.child('count').text], [3, 3, true, '3']);
  lgui.redDot.set('bag.equip', true);
  lgui.redDot.set('bag.mail', 2);
  assert.deepEqual([lgui.redDot.get('bag'), dot.child('count').text], [5, '5']);
  lgui.redDot.set('bag.newItem', false);
  lgui.redDot.set('bag.mail', 0);
  assert.deepEqual([lgui.redDot.get('bag'), dot.visible, dot.child('count').text], [true, true, ''], '只剩一个只亮不带数字的');
  lgui.redDot.set('bag.equip', false);
  assert.deepEqual([lgui.redDot.get('bag'), lgui.redDot.get('bag.newItem'), dot.visible], [false, false, false]);
  assert.throws(() => lgui.redDot.set('bag..x', true), e => e.code === 'LGUI-RT-120');
});

test('绑定了 redDot 的控件里没有 redDot 子控件时报 LGUI-UI-012', async () => {
  const {fw} = await started();
  const {lgui, View} = fw;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {gold: {redDot: 'bag'}}; }
  await assert.rejects(lgui.ui.open(BagView), e => e.code === 'LGUI-RT-080' && /LGUI-UI-012/.test(e.message));
});

test('按钮音效：配置了 sounds.click，点击时播放（headless 的音频调用记录里能看到）', async () => {
  const {fw, backend, sim} = await started({root: writeFixture(undefined, {sounds: true}), config: {sounds: {click: 'ui://Common/click'}}});
  const {lgui, View} = fw;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {sellButton: {click: () => {}}}; }
  const view = await lgui.ui.open(BagView);
  await sim.click(backend, view.__component.child('sellButton'));
  assert.deepEqual(backend.state.sounds, [{url: 'ui://Common/click', volume: 1}]);
});

test('默认不播音效（sounds.click 是 null）', async () => {
  const {fw, backend, sim} = await started();
  const {lgui, View} = fw;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {sellButton: {click: () => {}}}; }
  const view = await lgui.ui.open(BagView);
  await sim.click(backend, view.__component.child('sellButton'));
  assert.deepEqual(backend.state.sounds, []);
});

test('图片占位：打不开的地址 → 显示占位图（不写就用工程配置的默认占位图），并且记一条 warn（外部失败）', async () => {
  const {fw, backend} = await started({config: {placeholder: 'ui://Common/placeholder'}});
  const {lgui, View, ItemView, HeadlessLoader} = fw;
  class SlotView extends ItemView { static component = 'Bag/ItemSlot'; bind = {icon: {icon: it => it.url}}; }
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {list: {items: [{url: 'https://x/missing.png'}], item: SlotView}}; }
  HeadlessLoader.failExternal = true;
  try {
    const view = await lgui.ui.open(BagView);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(view.__component.child('list').itemAt(0).child('icon').url, 'ui://Common/placeholder');
    const warning = backend.state.logs.find(l => l.event === 'lgui_rt_070');
    assert.ok(warning && warning.level === 'warn' && warning.data.url === 'https://x/missing.png');
  } finally {
    HeadlessLoader.failExternal = false;
  }
});

test('图片占位：placeholder 设为 null 时，加载失败保持空字符串而不写入 "null"', async () => {
  const {fw, backend} = await started({config: {placeholder: null}});
  const {lgui, View, ItemView, HeadlessLoader} = fw;
  class SlotView extends ItemView { static component = 'Bag/ItemSlot'; bind = {icon: {icon: it => it.url}}; }
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {list: {items: [{url: 'https://x/missing.png'}], item: SlotView}}; }
  HeadlessLoader.failExternal = true;
  try {
    const view = await lgui.ui.open(BagView);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(view.__component.child('list').itemAt(0).child('icon').url, '');
    const warning = backend.state.logs.find(l => l.event === 'lgui_rt_070');
    assert.ok(warning && warning.level === 'warn');
  } finally {
    HeadlessLoader.failExternal = false;
  }
});
