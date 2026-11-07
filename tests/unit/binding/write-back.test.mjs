// 绑定的生命周期和回写：输入框截断后回写、lockWhilePending 的完成回调不碰已关闭的界面。用 headless 后端测。
import test from 'node:test';
import assert from 'node:assert/strict';
import {headless, started} from '../../helpers/framework.mjs';
import {writeFixture} from '../../helpers/fixture.mjs';
import {writeControls} from '../../conformance/controls.mjs';

async function controls() {
  const root = writeFixture();
  writeControls(root, {buttonId: 'cbtn0001'});
  const ctx = await headless({root});
  await ctx.backend.loadPackage('Common');
  await ctx.backend.loadPackage('Controls');
  const panel = ctx.backend.create('Controls', 'ControlsPanel');
  ctx.backend.root.addChild(panel);
  const mount = bind => {
    class ControlsView extends ctx.fw.View { static component = 'Controls/ControlsPanel'; static layer = 'page'; bind = bind; }
    const view = new ControlsView();
    view.__mount(panel);
    return view;
  };
  return {...ctx, panel, sim: ctx.fw.sim, mount};
}

test('input：Model 把文字截断成和上次一样的值时，框里也回写成 Model 的值', async () => {
  const {backend, panel, sim, mount, fw} = await controls();
  const {lgui, pick} = fw;
  const chat = lgui.Model({draft: ''}, set => ({setDraft(text) { set({draft: text.slice(0, 3)}); }}));
  const calls = [];
  mount({nameInput: {text: pick(chat, s => s.draft), input: text => { calls.push(text); chat.setDraft(text); }}});
  await sim.type(backend, panel.child('nameInput'), 'abcde');
  assert.deepEqual([chat.get().draft, panel.child('nameInput').text], ['abc', 'abc'], '第 4、5 个字被截掉，框里不留超长的字');
  assert.deepEqual(calls, ['a', 'ab', 'abc', 'abcd', 'abce'], '每个字照常调用一次 input，第 5 个字接在回写后的 abc 后面');
});

test('input：没绑 text 的输入框不回写（用户打什么显示什么）', async () => {
  const {backend, panel, sim, mount} = await controls();
  const calls = [];
  mount({nameInput: {input: text => calls.push(text)}});
  await sim.type(backend, panel.child('nameInput'), 'xy');
  assert.deepEqual([panel.child('nameInput').text, calls], ['xy', ['x', 'xy']]);
});

test('input：界面不激活、动作没执行时，框里回到 Model 的值', async () => {
  const {backend, panel, sim, fw} = await controls();
  const {lgui, pick, View} = fw;
  const form = lgui.Model({name: 'keep'});
  let active = true;
  class ControlsView extends View { static component = 'Controls/ControlsPanel'; static layer = 'page'; bind = {nameInput: {text: pick(form, s => s.name), input: text => form.set({name: text})}}; }
  new ControlsView().__mount(panel, {isActive: () => active});
  active = false;
  const input = panel.child('nameInput');
  input.text = 'typed';
  input.changes.emit('typed');
  assert.deepEqual([form.get().name, input.text], ['keep', 'keep']);
  void backend; void sim;
});

test('lockWhilePending：请求还没回来界面就关了，完成时不再碰控件；请求照常完成', async () => {
  const {fw, backend, sim} = await started();
  const {lgui, View} = fw;
  let resolve;
  const done = [];
  class ShopView extends View {
    static component = 'Bag/BagPanel'; static layer = 'popup';
    bind = {sellButton: {click: () => new Promise(r => { resolve = r; }).then(v => { done.push(v); }), lockWhilePending: true}};
  }
  const view = await lgui.ui.open(ShopView);
  const button = view.__component.child('sellButton');
  await sim.click(backend, button);
  assert.equal(button.enabled, false, '等待中锁住');
  lgui.ui.close(ShopView);
  let touched = 0;
  Object.defineProperty(button, 'enabled', {get: () => false, set: () => { touched++; }, configurable: true});
  resolve('sold');
  await sim.advance(backend, 16);
  assert.deepEqual([touched, done], [0, ['sold']], '关掉的界面不再改 enabled；动作自己的结果照常');
});

test('lockWhilePending：动作失败时照常解锁，错误不被绑定吞掉（交回去照常报出来）', async () => {
  const {fw, backend, sim} = await started();
  const {lgui, View} = fw;
  // 记下绑定在动作返回的 Promise 后面接出来的 Promise：错误要沿着它继续往外报，不在绑定里消失。
  const chained = [];
  class SpyPromise extends Promise {
    then(onFulfilled, onRejected) { const next = super.then(onFulfilled, onRejected); chained.push(next); return next; }
  }
  let reject;
  class ShopView extends View {
    static component = 'Bag/BagPanel'; static layer = 'popup';
    bind = {sellButton: {click: () => new SpyPromise((_, r) => { reject = r; }), lockWhilePending: true}};
  }
  const view = await lgui.ui.open(ShopView);
  const button = view.__component.child('sellButton');
  await sim.click(backend, button);
  assert.equal(chained.length, 1);
  const surfaced = assert.rejects(chained[0], /boom/);
  reject(new Error('boom'));
  await surfaced;
  assert.equal(button.enabled, true, '失败后解锁');
});
