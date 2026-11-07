// 再打开一个已经打开（或正在打开）的界面：参数相同合并成一次，参数不同报 LGUI-RT-240。
import test from 'node:test';
import assert from 'node:assert/strict';
import {started} from '../../helpers/framework.mjs';

async function setup() {
  const ctx = await started();
  const {View} = ctx.fw;
  const opened = [];
  class RewardView extends View {
    static component = 'Bag/ItemSlot'; static layer = 'popup'; static params = {id: 'none', count: 1};
    onOpen(p) { opened.push(p); }
  }
  class PlainView extends View { static component = 'Common/CurrencyBar'; static layer = 'popup'; }
  return {...ctx, opened, RewardView, PlainView};
}

test('参数相同（含不传和传默认值）：返回同一个 Promise，只打开一次', async () => {
  const {fw, opened, RewardView, PlainView} = await setup();
  const {lgui} = fw;
  const first = lgui.ui.open(RewardView, {id: 'gold', count: 2, extra: {tags: ['a']}});
  assert.equal(lgui.ui.open(RewardView, {count: 2, id: 'gold', extra: {tags: ['a']}}), first, '正在打开时，键的顺序不同也算相同');
  await first;
  assert.equal(lgui.ui.open(RewardView, {id: 'gold', count: 2, extra: {tags: ['a']}}), first, '已经打开时');
  assert.deepEqual(opened, [{id: 'gold', count: 2, extra: {tags: ['a']}}]);
  const plain = lgui.ui.open(PlainView);
  assert.equal(lgui.ui.open(PlainView), plain);
  await plain;
  lgui.ui.close(RewardView);
  const defaults = lgui.ui.open(RewardView);
  assert.equal(lgui.ui.open(RewardView, {id: 'none', count: 1}), defaults, '不传参数等于传 static params 的默认值');
  await defaults;
});

test('参数不同：报 LGUI-RT-240，写明两次的参数；第一次照常打开', async () => {
  const {fw, opened, RewardView, PlainView} = await setup();
  const {lgui} = fw;
  const first = lgui.ui.open(RewardView, {id: 'gold', count: 2});
  assert.throws(() => lgui.ui.open(RewardView, {id: 'gem', count: 2}), e => e.code === 'LGUI-RT-240' && /gold/.test(e.message) && /gem/.test(e.message));
  await first;
  assert.throws(() => lgui.ui.open(RewardView, {id: 'gold', count: 3}), e => e.code === 'LGUI-RT-240', '已经打开时也报');
  assert.throws(() => lgui.ui.open(RewardView), e => e.code === 'LGUI-RT-240', '不传参数（等于默认值）和打开时的参数不同');
  assert.deepEqual(opened, [{id: 'gold', count: 2}]);
  await lgui.ui.open(PlainView);
  assert.throws(() => lgui.ui.open(PlainView, {any: 1}), e => e.code === 'LGUI-RT-240', '没声明参数的界面，第二次传了参数');
});
