// 切换语言的换包空窗：浏览器后端先卸掉旧包、再加载新包。这段时间里界面的刷新、打开新界面都要等切换完成；
// 同时调用几次 setLanguage 按调用顺序一个一个切。headless 本身没有空窗，这里把它的 setLanguage 包成和 h5 一样先卸再装。
import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkTexts, started} from '../../helpers/framework.mjs';

async function setup() {
  const ctx = await started();
  const {backend, fw} = ctx;
  fw.setTexts({'zh-CN': {...frameworkTexts}, en: {...frameworkTexts}}, 'zh-CN');
  const calls = [];
  const gates = [];
  const original = backend.setLanguage.bind(backend);
  // 和 h5 后端一样：卸掉已加载的包，等一会儿（加载翻译和新包），再装回去。
  backend.setLanguage = async language => {
    calls.push(`start ${language}`);
    const loaded = [...backend.state.loaded];
    for (const name of loaded) backend.releasePackage(name);
    await new Promise(resolve => gates.push(resolve));
    for (const name of loaded) await backend.loadPackage(name);
    await original(language);
    calls.push(`end ${language}`);
  };
  // 等到后端走进空窗（包已经卸掉）。
  const inWindow = async () => { while (!gates.length) await new Promise(r => setImmediate(r)); };
  const release = () => gates.shift()();
  return {...ctx, calls, inWindow, release};
}

test('换包期间界面上的刷新（Model 变化、定时器）不去查资源，切完按最新数据显示', async () => {
  const {fw, backend, sim, inWindow, release} = await setup();
  const {lgui, View, pick} = fw;
  const slot = lgui.Model({url: 'ui://Bag/flag', ticks: 0});
  class SlotView extends View {
    static component = 'Bag/ItemSlot'; static layer = 'popup';
    bind = {icon: {icon: pick(slot, s => s.url)}, count: {text: pick(slot, s => String(s.ticks))}};
    // 定时刷新：每帧换一张图（换包期间去查图片所在的包就会报 LGUI-RT-071）。
    onOpen() { this.every(16, () => slot.set({ticks: slot.get().ticks + 1, url: slot.get().ticks % 2 ? 'ui://Bag/flag' : 'ui://Bag/dmg_1'})); }
  }
  const view = await lgui.ui.open(SlotView);
  const switching = lgui.setLanguage('en');
  await inWindow();
  assert.equal(backend.platform.resource.hasPackage('Bag'), false, '确实在空窗里');
  slot.set({url: 'ui://Bag/dmg_2'});
  await sim.advance(backend, 48);   // 定时器照常走（数据照常变），只是不刷到正要换掉的组件上
  slot.set({url: 'ui://Bag/flag'});
  release();
  await switching;
  const component = view.__component;
  assert.equal(component.child('icon').url, 'ui://Bag/flag@en', '切完按当前语言、最新数据重新取图');
  assert.equal(component.child('count').text, String(slot.get().ticks), '切完按最新数据显示');
  assert.ok(slot.get().ticks >= 3, '空窗里定时器照常走');
  assert.equal(backend.state.logs.filter(r => r.level === 'error').length, 0, '没有 LGUI-RT-071 之类的报错');
});

test('换包期间打开新界面：等切换完成再加载和显示，用的是新语言', async () => {
  const {fw, inWindow, release, calls} = await setup();
  const {lgui, View, pick} = fw;
  const slot = lgui.Model({url: 'ui://Bag/flag'});
  class SlotView extends View {
    static component = 'Bag/ItemSlot'; static layer = 'popup';
    bind = {icon: {icon: pick(slot, s => s.url)}};
    onOpen() { calls.push(`open ${lgui.language()}`); }
  }
  const switching = lgui.setLanguage('en');
  await inWindow();
  const opening = lgui.ui.open(SlotView);
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['start en'], '空窗里不加载、不显示');
  release();
  const view = await opening;
  await switching;
  assert.deepEqual(calls, ['start en', 'end en', 'open en'], '切换完成以后才打开');
  assert.equal(view.__component.child('icon').url, 'ui://Bag/flag@en');
});

test('同时调用几次 setLanguage：按调用顺序一个一个切，不交叠；最后是最后一次的语言', async () => {
  const {fw, inWindow, release, calls} = await setup();
  const {lgui} = fw;
  const events = [];
  fw.bus.on(lgui.events.languageChange, e => events.push(e.language));
  const first = lgui.setLanguage('en');
  const second = lgui.setLanguage('zh-CN');
  await inWindow();
  assert.deepEqual(calls, ['start en'], '第二次要等第一次切完');
  release();
  await first;
  await inWindow();
  release();
  await second;
  assert.deepEqual(calls, ['start en', 'end en', 'start zh-CN', 'end zh-CN']);
  assert.deepEqual([events, lgui.language()], [['en', 'zh-CN'], 'zh-CN']);
});

test('切换失败：错误交给这次的调用方，界面照常刷新，后面的切换照常进行', async () => {
  const {fw, backend, sim, calls} = await setup();
  const {lgui, View, pick} = fw;
  const slot = lgui.Model({ticks: 0});
  class SlotView extends View { static component = 'Bag/ItemSlot'; static layer = 'popup'; bind = {count: {text: pick(slot, s => String(s.ticks))}}; }
  const view = await lgui.ui.open(SlotView);
  const working = backend.setLanguage;
  backend.setLanguage = async () => { throw new Error('翻译文件坏了'); };
  await assert.rejects(lgui.setLanguage('en'), /翻译文件坏了/);
  assert.equal(lgui.language(), 'zh-CN');
  slot.set({ticks: 5});
  assert.equal(view.__component.child('count').text, '5', '失败以后界面照常刷新');
  backend.setLanguage = async language => { calls.push(`ok ${language}`); };
  await lgui.setLanguage('en');
  assert.deepEqual([calls, lgui.language()], [['ok en'], 'en']);
  void working; void sim;
});

test('不支持的语言：马上报 LGUI-RT-140，不排队', async () => {
  const {fw, calls} = await setup();
  const {lgui} = fw;
  await assert.rejects(lgui.setLanguage('fr'), e => e.code === 'LGUI-RT-140');
  assert.deepEqual(calls, []);
});

test('换包期间打开界面缓存里的界面：不用缓存里旧语言的组件，切完按新语言重新建', async () => {
  const ctx = await setup();
  const {fw, inWindow, release, ui} = ctx;
  const {lgui, View, pick} = fw;
  ui.settings.uiCache = {keepClosedViews: 2};
  const slot = lgui.Model({url: 'ui://Bag/flag'});
  class SlotView extends View { static component = 'Bag/ItemSlot'; static layer = 'popup'; bind = {icon: {icon: pick(slot, s => s.url)}}; }
  const first = await lgui.ui.open(SlotView);
  const old = first.__component;
  lgui.ui.close(SlotView);
  assert.equal(ui.cachedCount(), 1);
  const switching = lgui.setLanguage('en');
  await inWindow();
  const opening = lgui.ui.open(SlotView);
  release();
  const view = await opening;
  await switching;
  assert.notEqual(view.__component, old, '没用缓存里旧语言的组件');
  assert.equal(view.__component.child('icon').url, 'ui://Bag/flag@en');
});

test('modal 队列：切换中放出排队的 modal，等切完再显示（不在包不在时建组件）', async () => {
  const {fw, inWindow, release, calls} = await setup();
  const {lgui, View, pick} = fw;
  const slot = lgui.Model({url: 'ui://Bag/flag'});
  class FirstModal extends View { static component = 'Common/CurrencyBar'; static layer = 'modal'; }
  class SecondModal extends View {
    static component = 'Bag/ItemSlot'; static layer = 'modal';
    bind = {icon: {icon: pick(slot, s => s.url)}};
    onOpen() { calls.push(`open ${lgui.language()}`); }
  }
  await lgui.ui.open(FirstModal);
  const second = lgui.ui.open(SecondModal);
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  const switching = lgui.setLanguage('en');   // 在 modal 里切语言，不等它
  await inWindow();
  lgui.ui.close(FirstModal);                   // 关掉，排队的 SecondModal 被放出
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['start en'], '空窗里放出的 modal 不显示');
  release();
  const view = await second;
  await switching;
  assert.deepEqual(calls, ['start en', 'end en', 'open en']);
  assert.equal(view.__component.child('icon').url, 'ui://Bag/flag@en');
});

test('modal 队列：排队时取了缓存组件，排队期间换了语言，轮到它时不用旧语言的组件', async () => {
  const {fw, inWindow, release, ui} = await setup();
  const {lgui, View} = fw;
  ui.settings.uiCache = {keepClosedViews: 2};
  class FirstModal extends View { static component = 'Common/CurrencyBar'; static layer = 'modal'; }
  class SecondModal extends View { static component = 'Bag/ItemSlot'; static layer = 'modal'; }
  const old = (await lgui.ui.open(SecondModal)).__component;
  lgui.ui.close(SecondModal);
  await lgui.ui.open(FirstModal);
  const second = lgui.ui.open(SecondModal);   // 从缓存取组件，排在 FirstModal 后面
  const switching = lgui.setLanguage('en');
  await inWindow();
  release();
  await switching;                            // 整个切换都在它排队期间完成
  lgui.ui.close(FirstModal);
  const view = await second;
  assert.notEqual(view.__component, old, '没用排队前取的旧语言组件');
  assert.equal(ui.packageRefs().find(p => p.name === 'Bag')?.refs, 1, '包引用照常只记一份');
});
