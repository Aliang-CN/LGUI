// UIManager：方案 5.10 的每条规则，用 headless 后端测。
import test from 'node:test';
import assert from 'node:assert/strict';
import {started} from '../../helpers/framework.mjs';

// 用测试界面里的组件定义几种 View。
async function setup() {
  const ctx = await started();
  const {View} = ctx.fw;
  const log = [];
  const hooks = name => class extends View {
    onOpen(p) { log.push(`${name}.onOpen${p ? ' ' + JSON.stringify(p) : ''}`); }
    onActivate() { log.push(`${name}.onActivate`); }
    onDeactivate() { log.push(`${name}.onDeactivate`); }
    onCovered() { log.push(`${name}.onCovered`); }
    onRevealed() { log.push(`${name}.onRevealed`); }
    onClose() { log.push(`${name}.onClose`); }
  };
  class MainView extends hooks('Main') { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; }
  class BagView extends hooks('Bag') { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static params = {tab: 'equip'}; }
  class HudView extends hooks('Hud') { static component = 'Common/CurrencyBar'; static layer = 'hud'; }
  class DetailView extends hooks('Detail') { static component = 'Bag/ItemSlot'; static layer = 'popup'; }
  class PickerView extends hooks('Picker') { static component = 'Bag/ItemSlot'; static layer = 'popup'; }
  class Reward1 extends hooks('Reward1') { static component = 'Common/CurrencyBar'; static layer = 'modal'; }
  class Reward2 extends hooks('Reward2') { static component = 'Bag/ItemSlot'; static layer = 'modal'; }
  class ToastView extends hooks('Toast') { static component = 'Bag/Header'; static layer = 'toast'; }
  return {...ctx, log, views: {MainView, BagView, HudView, DetailView, PickerView, Reward1, Reward2, ToastView}};
}

// A genuinely incomplete Bag acquisition ahead of a ready Common acquisition.
// Promise gates control completion/error; no clock delay guesses queue readiness.
async function delayedModalPair({throwOnOpen = false} = {}) {
  const ctx = await setup();
  const {fw, backend, sim} = ctx;
  const {lgui, View} = fw;
  const opened = [], status = {first: 'pending', second: 'pending'};
  class SlowFirst extends View {
    static component = 'Bag/ItemSlot'; static layer = 'modal';
    onOpen() { opened.push('A'); if (throwOnOpen) throw new Error('controlled onOpen failure'); }
  }
  class ReadySecond extends View {
    static component = 'Common/CurrencyBar'; static layer = 'modal';
    onOpen() { opened.push('B'); }
  }
  assert.equal(backend.platform.resource.hasPackage('Bag'), false);
  assert.equal(backend.platform.resource.hasPackage('Common'), true);
  const originalLoad = backend.loadPackage;
  let resolveLoad, rejectLoad, enteredLoad;
  const gate = new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; });
  const entered = new Promise(resolve => { enteredLoad = resolve; });
  backend.loadPackage = async name => {
    assert.equal(name, 'Bag');
    enteredLoad();
    await gate;
    return originalLoad(name);
  };
  const track = (name, pending) => pending.then(view => { status[name] = 'resolved'; return view; }, error => { status[name] = 'rejected'; throw error; });
  const first = track('first', lgui.ui.open(SlowFirst));
  const second = track('second', lgui.ui.open(ReadySecond));
  void first.catch(() => {}); void second.catch(() => {});
  await entered;
  await sim.advance(backend, 0);
  return {...ctx, SlowFirst, ReadySecond, first, second, status, opened, resolveLoad, rejectLoad,
    async cleanup() {
      resolveLoad();
      lgui.ui.closeAll('modal');
      await Promise.allSettled([first, second]);
      backend.loadPackage = originalLoad;
    }};
}

test('5 个容器按 hud → page → popup → modal → toast 叠在根节点下', async () => {
  const {backend} = await setup();
  assert.deepEqual(backend.root.childNames(), ['hud', 'page', 'popup', 'modal', 'toast']);
});

test('钩子顺序：打开 onOpen → onActivate；被压住 onDeactivate；关闭 onDeactivate → onClose', async () => {
  const {fw, log, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView, {id: 1});
  lgui.ui.close(DetailView);
  assert.deepEqual(log, ['Main.onOpen', 'Main.onActivate', 'Detail.onOpen {"id":1}', 'Main.onDeactivate', 'Detail.onActivate', 'Detail.onDeactivate', 'Detail.onClose', 'Main.onActivate']);
});

test('激活：所有层合起来最上面那个可交互；其余停用（不可点但看得见）', async () => {
  const {fw, views: {MainView, HudView, DetailView, ToastView}} = await setup();
  const {lgui} = fw;
  const hud = await lgui.ui.open(HudView);
  const main = await lgui.ui.open(MainView);
  const detail = await lgui.ui.open(DetailView);
  await lgui.ui.open(ToastView);
  assert.equal(lgui.ui.top(), detail, 'toast 不参与激活');
  assert.deepEqual([main.__component.touchable, main.__component.visible, detail.__component.touchable], [false, true, true]);
  assert.equal(hud.__component.visible, false, '全屏界面盖住了下面层的 hud');
});

test('全屏界面盖住下面所有层：隐藏、暂停定时器、onCovered；关掉后露出来、onRevealed（关掉全屏界面，上一个自动回来）', async () => {
  const {fw, backend, sim, log, views: {MainView, BagView, HudView}} = await setup();
  const {lgui} = fw;
  const hud = await lgui.ui.open(HudView);
  const main = await lgui.ui.open(MainView);
  let ticks = 0;
  hud.__timers.every(100, () => ticks++);
  log.length = 0;
  await lgui.ui.open(BagView);
  assert.deepEqual([main.__component.visible, log.includes('Main.onCovered')], [false, true]);
  await sim.advance(backend, 500);
  assert.equal(ticks, 0, 'hud 被盖住时定时器暂停');
  lgui.ui.close(BagView);
  assert.deepEqual([main.__component.visible, lgui.ui.top(), log.includes('Main.onRevealed')], [true, main, true]);
  assert.equal(hud.__component.visible, false, 'Main 也是全屏，hud 还被它盖着');
});

test('modal 是队列：同时只显示一个，前一个关掉下一个才弹出来；modal 打开时下面全部停用', async () => {
  const {fw, views: {MainView, Reward1, Reward2}} = await setup();
  const {lgui} = fw;
  const main = await lgui.ui.open(MainView);
  const first = await lgui.ui.open(Reward1);
  let secondShown = false;
  const second = lgui.ui.open(Reward2).then(v => { secondShown = true; return v; });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual([secondShown, lgui.ui.isOpen(Reward2), main.__component.touchable, lgui.ui.top()], [false, false, false, first]);
  lgui.ui.close(Reward1);
  const v2 = await second;
  assert.deepEqual([secondShown, lgui.ui.top()], [true, v2]);
});

test('同 tick 同包并发 modal 按 open 调用顺序 FIFO：先 A，关 A 后 B 的 ready 才完成', async () => {
  const {fw, backend, sim} = await setup();
  const {lgui, View} = fw;
  const opened = [];
  class ModalA extends View {
    static component = 'Bag/ItemSlot'; static layer = 'modal';
    onOpen() { opened.push('A'); }
  }
  class ModalB extends View {
    static component = 'Bag/ItemSlot'; static layer = 'modal';
    onOpen() { opened.push('B'); }
  }
  assert.equal(backend.platform.resource.hasPackage('Bag'), false);
  const originalLoad = backend.loadPackage;
  let releaseLoad, enteredLoad, loadCalls = 0;
  const gate = new Promise(resolve => { releaseLoad = resolve; });
  const loadingEntered = new Promise(resolve => { enteredLoad = resolve; });
  backend.loadPackage = async name => {
    assert.equal(name, 'Bag');
    loadCalls++;
    enteredLoad();
    await gate;
    return originalLoad(name);
  };
  let firstReady = false, secondReady = false;
  // No await between these calls: both entries exist before the shared package
  // load completes, just like the two reward dialogs from one claim action.
  const first = lgui.ui.open(ModalA).then(view => { firstReady = true; return view; });
  const second = lgui.ui.open(ModalB).then(view => { secondReady = true; return view; });
  // Failed assertions also close queued dialogs; handle their normal cancellation.
  void first.catch(() => {}); void second.catch(() => {});
  try {
    await loadingEntered;
    assert.equal(loadCalls, 1, 'same-package opens share the actual core acquisition');
    releaseLoad();
    await sim.advance(backend, 0);
    assert.deepEqual({active: lgui.debug.snapshot().active, opened, firstReady, secondReady},
      {active: 'ModalA', opened: ['A'], firstReady: true, secondReady: false});
    assert.equal(lgui.ui.isOpen(ModalB), false, 'B stays queued while A is active');
    assert.strictEqual(lgui.ui.top(), await first);
    lgui.ui.close(ModalA);
    const shownSecond = await second;
    assert.strictEqual(lgui.ui.top(), shownSecond);
    assert.equal(lgui.debug.snapshot().active, 'ModalB');
    assert.deepEqual(opened, ['A', 'B']);
    assert.equal(secondReady, true);
  } finally {
    releaseLoad();
    lgui.ui.closeAll('modal');
    await Promise.allSettled([first, second]);
    backend.loadPackage = originalLoad;
  }
});

test('modal FIFO：后项 acquire 先完成也不能跳过仍在加载的前项', async () => {
  const ctx = await delayedModalPair();
  const {fw: {lgui}, backend, sim, status, opened, first, second, SlowFirst, resolveLoad} = ctx;
  try {
    assert.deepEqual({active: lgui.debug.snapshot().active, status: {...status}, opened: [...opened]},
      {active: null, status: {first: 'pending', second: 'pending'}, opened: []});
    resolveLoad();
    await sim.advance(backend, 0);
    assert.deepEqual({active: lgui.debug.snapshot().active, status: {...status}, opened: [...opened]},
      {active: 'SlowFirst', status: {first: 'resolved', second: 'pending'}, opened: ['A']});
    assert.strictEqual(lgui.ui.top(), await first);
    lgui.ui.close(SlowFirst);
    const shownSecond = await second;
    assert.strictEqual(lgui.ui.top(), shownSecond);
    assert.deepEqual(opened, ['A', 'B']);
  } finally { await ctx.cleanup(); }
});

test('modal FIFO：前项 acquire 失败会立即解阻已就绪的后项', async () => {
  const ctx = await delayedModalPair();
  const {fw: {lgui}, backend, sim, status, opened, first, second, rejectLoad, ui} = ctx;
  try {
    rejectLoad(new Error('controlled package failure'));
    await assert.rejects(first, error => error.code === 'LGUI-RT-080' && /controlled package failure/.test(error.message));
    await sim.advance(backend, 0);
    assert.deepEqual({active: lgui.debug.snapshot().active, status: {...status}, opened: [...opened]},
      {active: 'ReadySecond', status: {first: 'rejected', second: 'resolved'}, opened: ['B']});
    assert.strictEqual(lgui.ui.top(), await second);
    assert.equal(ui.packageRefs().some(pkg => pkg.name === 'Bag'), false, 'failed first acquisition releases its package reference');
  } finally { await ctx.cleanup(); }
});

test('modal FIFO：前项加载时取消会解阻后项，无需等前项资源完成', async () => {
  const ctx = await delayedModalPair();
  const {fw: {lgui}, backend, sim, status, opened, first, second, SlowFirst, resolveLoad, ui} = ctx;
  try {
    lgui.ui.close(SlowFirst);
    await sim.advance(backend, 0);
    assert.deepEqual({active: lgui.debug.snapshot().active, status: {...status}, opened: [...opened]},
      {active: 'ReadySecond', status: {first: 'pending', second: 'resolved'}, opened: ['B']});
    assert.strictEqual(lgui.ui.top(), await second);
    resolveLoad();
    await assert.rejects(first, error => error.code === 'LGUI-RT-081');
    assert.equal(ui.packageRefs().some(pkg => pkg.name === 'Bag'), false, 'cancelled first acquisition releases exactly once when its load completes');
  } finally { await ctx.cleanup(); }
});

test('modal FIFO：前项 onOpen 抛错也会解阻后项，不留半成品', async () => {
  const ctx = await delayedModalPair({throwOnOpen: true});
  const {fw: {lgui}, backend, sim, status, opened, first, second, resolveLoad, ui} = ctx;
  try {
    resolveLoad();
    await assert.rejects(first, error => error.code === 'LGUI-RT-080' && /controlled onOpen failure/.test(error.message));
    await sim.advance(backend, 0);
    assert.deepEqual({active: lgui.debug.snapshot().active, status: {...status}, opened: [...opened]},
      {active: 'ReadySecond', status: {first: 'rejected', second: 'resolved'}, opened: ['A', 'B']});
    assert.strictEqual(lgui.ui.top(), await second);
    assert.equal(ui.packageRefs().some(pkg => pkg.name === 'Bag'), false);
  } finally { await ctx.cleanup(); }
});

test('排队中的 modal 被关掉：马上释放界面包（打开那边报 LGUI-RT-081），不会等下一帧', async () => {
  const {fw, views: {Reward1, Reward2}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(Reward1);
  const second = lgui.ui.open(Reward2);
  await new Promise(r => setTimeout(r, 0));
  const refs = () => Object.fromEntries(lgui.debug.snapshot().packages.map(p => [p.name, p.refs]));
  assert.equal(refs().Bag, 1, '排队的 Reward2 占着 Bag 包');
  lgui.ui.closeAll('modal');
  assert.equal(refs().Bag, undefined, '关掉的同时就释放了');
  await assert.rejects(second, e => e.code === 'LGUI-RT-081');
  assert.equal(refs().Bag, undefined, '不重复释放');
});

test('page 层最底下的主界面按返回键关不掉；back 关闭当前激活的界面', async () => {
  const {fw, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  const main = await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView);
  lgui.ui.back();
  assert.equal(lgui.ui.isOpen(DetailView), false);
  lgui.ui.back();
  assert.equal(lgui.ui.top(), main);
});

test('replace、popTo、closeAll、list、get', async () => {
  const {fw, views: {MainView, BagView, DetailView, PickerView}} = await setup();
  const {lgui} = fw;
  const main = await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView);
  await lgui.ui.replace(PickerView);
  assert.deepEqual(lgui.ui.list('popup').map(v => v.constructor.name), ['PickerView']);
  await lgui.ui.open(BagView);
  await lgui.ui.open(DetailView);
  lgui.ui.popTo(MainView);
  assert.deepEqual([lgui.ui.list('page'), lgui.ui.list('popup')], [[main], []]);
  await lgui.ui.open(DetailView);
  lgui.ui.closeAll('popup');
  assert.equal(lgui.ui.get(DetailView), undefined);
});

test('onClose 第 1 条：B 不管怎么关闭（自己关、返回键、closeAll、replace）都调用一次', async () => {
  const {fw, views: {MainView, DetailView, PickerView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  const calls = [];
  for (const how of ['close', 'back', 'closeAll', 'replace']) {
    await lgui.ui.open(DetailView, undefined, {onClose: r => calls.push([how, r])});
    if (how === 'close') lgui.ui.close(DetailView);
    if (how === 'back') lgui.ui.back();
    if (how === 'closeAll') lgui.ui.closeAll('popup');
    if (how === 'replace') { await lgui.ui.replace(PickerView); lgui.ui.close(PickerView); }
  }
  assert.deepEqual(calls, [['close', undefined], ['back', undefined], ['closeAll', undefined], ['replace', undefined]]);
});

test('onClose 第 2 条：可以顺带交回东西；不交回时是 undefined', async () => {
  const {fw, views: {MainView, PickerView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  const got = [];
  await lgui.ui.open(PickerView, undefined, {onClose: r => got.push(r)});
  lgui.ui.close(PickerView, {itemId: 'sword'});
  await lgui.ui.open(PickerView, undefined, {onClose: r => got.push(r)});
  lgui.ui.close(PickerView);
  assert.deepEqual(got, [{itemId: 'sword'}, undefined]);
});

test('onClose 第 3 条：打开者在动作或钩子里同步记下；打开者先关了，回调自动取消', async () => {
  const {fw, views: {MainView, BagView, PickerView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  const got = [];
  class OpenerView extends BagView { onOpen() { lgui.ui.open(PickerView, undefined, {onClose: () => got.push('closed')}); } }
  await lgui.ui.open(OpenerView);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(lgui.ui.isOpen(PickerView), true);
  lgui.ui.close(OpenerView);
  lgui.ui.close(PickerView);
  assert.deepEqual(got, []);
});

test('onClose 第 5 条和广播站：A 关闭后 B 收到 viewClosed', async () => {
  const {fw, views: {MainView, DetailView}} = await setup();
  const {lgui, View} = fw;
  const seen = [];
  class Listener extends View { static component = 'Bag/ItemSlot'; static layer = 'hud'; onOpen() { this.on(lgui.events.viewClosed, e => seen.push(e.view.name)); } }
  await lgui.ui.open(Listener);
  await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView);
  lgui.ui.close(DetailView);
  assert.deepEqual(seen, ['DetailView']);
});

test('同一个界面正在打开时又被打开：合并成一次；正在打开时被关闭：取消（LGUI-RT-081），资源释放', async () => {
  const {fw, ui, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  const a = lgui.ui.open(DetailView), b = lgui.ui.open(DetailView);
  assert.equal(a, b);
  await a;
  lgui.ui.close(DetailView);
  const opening = lgui.ui.open(DetailView);
  lgui.ui.close(DetailView);
  await assert.rejects(opening, e => e.code === 'LGUI-RT-081');
  assert.equal(lgui.ui.isOpen(DetailView), false);
  assert.deepEqual(ui.packageRefs().map(p => `${p.name}:${p.refs}`).sort(), ['Bag:1', 'Common:1']);
});

test('加载失败报 LGUI-RT-080，不留半成品；关闭没打开的界面只记日志（LGUI-RT-082）', async () => {
  const {fw, backend, ui, views: {DetailView}} = await setup();
  const {lgui, View} = fw;
  class Broken extends View { static component = 'Nope/Missing'; static layer = 'popup'; }
  await assert.rejects(lgui.ui.open(Broken), e => e.code === 'LGUI-RT-080');
  assert.deepEqual([ui.all().length, ui.packageRefs().length], [0, 0]);
  lgui.ui.close(DetailView);
  assert.deepEqual([backend.state.logs.at(-1).level, backend.state.logs.at(-1).data.code], ['info', 'LGUI-RT-082']);
});

test('界面关闭后包引用归零、监听和定时器清干净', async () => {
  const {fw, ui, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  for (let i = 0; i < 20; i++) { await lgui.ui.open(MainView); await lgui.ui.open(DetailView); lgui.ui.closeAll('popup'); lgui.ui.closeAll('page'); }
  assert.deepEqual([ui.all().length, ui.packageRefs().length], [0, 0]);
});

// 让界面包的加载停在半路，放行后才加载完（模拟网络慢）。
function gateLoads(backend, names) {
  const load = backend.loadPackage;
  let open;
  const gate = new Promise(r => { open = r; });
  backend.loadPackage = name => names.includes(name) ? gate.then(() => load(name)) : load(name);
  return () => open();
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('同一轮里先后打开两个 modal：按调用顺序显示，后一个排队', async () => {
  const {fw, views: {MainView, Reward1, Reward2}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  const first = lgui.ui.open(Reward1);
  const second = lgui.ui.open(Reward2);
  await tick();
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward1']);
  lgui.ui.close(Reward1);
  await second;
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward2']);
  await first;
});

test('排在前面的 modal 在加载中被关掉：后面排队的照常弹出；包引用马上释放，加载完也不留着', async () => {
  const {fw, backend, ui, views: {Reward1, Reward2}} = await setup();
  const {lgui} = fw;
  const release = gateLoads(backend, ['Bag']);
  const slow = lgui.ui.open(Reward2);          // Bag 包加载中
  const next = lgui.ui.open(Reward1);          // 排在它后面
  await tick();
  assert.equal(lgui.ui.isOpen(Reward1), false, '排队');
  lgui.ui.close(Reward2);
  assert.equal(ui.packageRefs().find(p => p.name === 'Bag'), undefined, '关掉的同时就释放了引用');
  await next;
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward1']);
  release();
  await assert.rejects(slow, e => e.code === 'LGUI-RT-081');
  await tick();
  assert.equal(backend.state.loaded.has('Bag'), false, '没人用的包加载完马上卸载');
});

test('排在前面的 modal 打开失败（onOpen 抛错）：后面排队的照常弹出', async () => {
  const {fw, backend, views: {Reward1}} = await setup();
  const {lgui, View} = fw;
  class Broken extends View { static component = 'Bag/Header'; static layer = 'modal'; onOpen() { throw new Error('坏了'); } }
  const release = gateLoads(backend, ['Bag']);
  const broken = lgui.ui.open(Broken);
  const next = lgui.ui.open(Reward1);
  await tick();
  assert.equal(lgui.ui.isOpen(Reward1), false, '排队');
  release();
  await assert.rejects(broken, e => e.code === 'LGUI-RT-080');
  await next;
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward1']);
});

test('排在前面的 modal 加载失败：后面排队的照常弹出', async () => {
  const {fw, backend, views: {Reward1}} = await setup();
  const {lgui, View} = fw;
  class Missing extends View { static component = 'Nope/Missing'; static layer = 'modal'; }
  const load = backend.loadPackage;
  let fail;
  backend.loadPackage = name => name === 'Nope' ? new Promise((_, reject) => { fail = () => reject(new Error('没有')); }) : load(name);
  const missing = lgui.ui.open(Missing);
  const next = lgui.ui.open(Reward1);
  await tick();
  assert.equal(lgui.ui.isOpen(Reward1), false, '排队');
  fail();
  await assert.rejects(missing, e => e.code === 'LGUI-RT-080');
  await next;
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward1']);
});

test('关掉 loading 不会把排队的 modal 弹到已经打开的 modal 上面', async () => {
  const {fw, views: {Reward1, Reward2}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(Reward1);
  const queued = lgui.ui.open(Reward2);
  await tick();
  lgui.loading.show();
  await tick();
  lgui.loading.hide();
  await tick();
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward1']);
  lgui.ui.close(Reward1);
  await queued;
  assert.deepEqual(lgui.debug.snapshot().layers.modal, ['Reward2']);
});

test('closeAll、popTo：全部关完才重新算一次激活，要关掉的界面收不到 onActivate、onRevealed', async () => {
  const {fw, log, views: {MainView, BagView, DetailView, PickerView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  await lgui.ui.open(DetailView);
  await lgui.ui.open(PickerView);
  log.length = 0;
  lgui.ui.closeAll('popup');
  assert.deepEqual(log, ['Picker.onDeactivate', 'Picker.onClose', 'Detail.onClose', 'Main.onActivate']);
  await lgui.ui.open(BagView);
  await lgui.ui.open(DetailView);
  log.length = 0;
  lgui.ui.popTo(MainView);
  assert.deepEqual(log, ['Detail.onDeactivate', 'Detail.onClose', 'Bag.onClose', 'Main.onRevealed', 'Main.onActivate']);
});

test('返回键不关 hud 层的界面；keys.back 写成函数时照常调用；操作提示栏也不显示返回', async () => {
  const {fw, ui, views: {HudView, DetailView}} = await setup();
  const {lgui} = fw;
  const hud = await lgui.ui.open(HudView);
  lgui.ui.back();
  assert.equal(lgui.ui.isOpen(HudView), true);
  assert.equal(ui.hintBar.component.child('list').numItems, 0, 'hud 上不显示返回');
  await lgui.ui.open(DetailView);
  assert.equal(ui.hintBar.component.child('list').numItems, 1, 'popup 上显示返回');
  lgui.ui.close(DetailView);
  let called = 0;
  hud.keys = {back: () => { called++; }};
  lgui.ui.back();
  assert.deepEqual([called, lgui.ui.isOpen(HudView)], [1, true]);
});

test('对已经打开（或正在打开）的界面再 open：参数相同返回同一个 Promise，参数不同报 LGUI-RT-240；又登记 onClose 时报 LGUI-RT-084', async () => {
  const {fw, views: {MainView, DetailView}} = await setup();
  const {lgui} = fw;
  await lgui.ui.open(MainView);
  const opening = lgui.ui.open(DetailView);
  assert.equal(lgui.ui.open(DetailView), opening, '参数相同，合并成一次');
  assert.throws(() => lgui.ui.open(DetailView, {id: 2}), e => e.code === 'LGUI-RT-240', '参数不同不静默丢掉');
  assert.throws(() => lgui.ui.open(DetailView, undefined, {onClose: () => {}}), e => e.code === 'LGUI-RT-084');
  await opening;
  assert.throws(() => lgui.ui.open(DetailView, undefined, {onClose: () => {}}), e => e.code === 'LGUI-RT-084');
  assert.equal(lgui.ui.open(MainView), lgui.ui.open(MainView));
});
