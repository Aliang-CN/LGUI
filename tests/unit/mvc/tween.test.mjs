// 代码补间（this.tween / stopTweens / itemsOf）、绑定的 roll 和 tick、按钮的按下与回弹、format.duration。
// 用 headless 后端和假时钟（t.advance）判断，不用真实时间。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {writeFixture, bagPanel} from '../../helpers/fixture.mjs';
import {headless, frameworkTexts} from '../../helpers/framework.mjs';
import {generateProjectTypes} from '../../../plugin/tools/lib/generate/index.mjs';

// BagPanel 里补间要用的控件（横版、竖版同名）。
const extra = `
    <image id="t1" name="coin" src="flag0001" xy="100,300" size="64,64" pivot="0.5,0.5"/>
    <image id="t2" name="corner" src="flag0001" xy="200,300" size="64,64"/>
    <image id="t3" name="cool" src="flag0001" xy="300,300" size="64,64" pivot="0.5,0.5" fillMethod="radial360" fillAmount="100"/>
    <text id="t4" name="price" xy="0,400" size="200,40" fontSize="20" color="#ffffff" autoSize="none" text="100"/>
    <text id="t5" name="line" xy="0,450" size="600,40" fontSize="20" autoSize="none" text=""/>
    <text id="t6" name="timer" xy="0,500" size="200,40" fontSize="20" autoSize="none" text=""/>
    <component id="t7" name="claim" src="pbtn0001" xy="0,600" size="160,56"/>
    <component id="t8" name="dark" src="dbtn0001" xy="200,600" size="160,56"/>
    <list id="t9" name="rewards" xy="0,700" size="400,100" layout="row" defaultItem="ui://bag00001rslot001"/>
    <component id="ta" name="bar" src="bar00001" xy="0,800" size="160,6"/>
    <image id="tb" name="geared" src="flag0001" xy="400,300" size="64,64" pivot="0.5,0.5"><gearSize controller="tabs" pages="0,1" values="64,64,1,1|80,80,1,1"/></image>
    <text id="tc" name="rich" xy="0,850" size="600,40" fontSize="20" autoSize="none" text=""/>`;
const motion = `
  <transition name="blink">
    <item time="0" type="Alpha" target="t1" tween="true" startValue="1" endValue="0" duration="24"/>
  </transition>`;
const panel = size => bagPanel({size, extra}).replace(/<\/component>\s*$/, `${motion}\n</component>\n`);

function tweenFixture() {
  const root = writeFixture(undefined, {landscape: panel('1920,1080'), portrait: panel('1080,1920')});
  const bag = path.join(root, 'ui/assets/Bag');
  const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;
  const pkg = path.join(bag, 'package.xml');
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('</resources>', `    <component id="pbtn0001" name="PressBtn.xml" path="/"/>
    <component id="dbtn0001" name="DarkBtn.xml" path="/"/>
    <component id="rslot001" name="Reward.xml" path="/" exported="true"/>
  </resources>`));
  const button = effect => xml(`<component size="160,56" extention="Button">
  <controller name="button" pages="0,up,1,down" selected="0"/>
  <displayList>
    <text id="n0" name="title" xy="0,0" size="160,56" fontSize="24" color="#333333" autoSize="none" singleLine="true" text="领取"/>
  </displayList>
  <Button ${effect}/>
</component>`);
  fs.writeFileSync(path.join(bag, 'PressBtn.xml'), button('downEffect="scale" downEffectValue="0.8"'));
  fs.writeFileSync(path.join(bag, 'DarkBtn.xml'), button('downEffect="dark" downEffectValue="0.6"'));
  fs.writeFileSync(path.join(bag, 'Reward.xml'), xml(`<component size="80,80" pivot="0.5,0.5">
  <displayList>
    <loader id="n0" name="icon" xy="0,0" size="80,80"/>
  </displayList>
</component>`));
  return root;
}

async function setup({config = {}, production = false} = {}) {
  const root = tweenFixture();
  const {fw, deps} = await headless({root, production});
  const dir = path.join(root, '.lgui/build/headless');
  const packages = fs.readdirSync(dir).map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  globalThis.__lguiTest = {createBackend: () => fw.createHeadlessBackend(packages), sim: fw.sim, deps, config: {...fw.defaultConfig, ...config}, texts: {'zh-CN': {...frameworkTexts}, en: {...frameworkTexts, 'lgui.time.day': '{n}d', 'lgui.time.hour': '{n}h', 'lgui.time.minute': '{n}m', 'lgui.time.second': '{n}s'}}, current: null};
  const {lgui, View, ItemView, pick, format} = fw;
  class CoverView extends View { static component = 'Common/Loading'; static layer = 'popup'; static fullScreen = true; static bothOrientations = true; }
  const t = await lgui.testing.start({backend: 'headless', start() {}});
  globalThis.__tween = {lgui, pick, ItemView};
  return {fw, root, lgui, View, ItemView, pick, format, CoverView, t, P: 'Bag/BagPanel'};
}
const teardown = () => { delete globalThis.__lguiTest; delete globalThis.__tween; };

test('headless 描述：轴心、缩放、颜色、字号、填充、按钮的按下效果、组件的轴心', async () => {
  const root = tweenFixture();
  await generateProjectTypes(root);
  const bag = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/headless/Bag.json'), 'utf8'));
  const children = bag.components.find(c => c.name === 'Bag/BagPanel').children;
  const props = name => children.find(c => c.name === name).props;
  assert.deepEqual(props('coin').pivot, [0.5, 0.5]);
  assert.equal(props('corner').pivot, undefined);
  assert.deepEqual([props('cool').fillMethod, props('cool').fillAmount], ['radial360', 1]);
  assert.deepEqual([props('price').color, props('price').fontSize], ['#ffffff', 20]);
  assert.deepEqual(bag.components.find(c => c.name === 'Bag/PressBtn').downEffect, {type: 'scale', value: 0.8});
  assert.deepEqual(bag.components.find(c => c.name === 'Bag/DarkBtn').downEffect, {type: 'dark', value: 0.6});
  assert.deepEqual(bag.components.find(c => c.name === 'Bag/Reward').pivot, [0.5, 0.5]);
});

test('roll：金币 0.5 秒滚到新值；打开时直接显示，不滚；滚动中值又变了从现在显示的数接着滚', async () => {
  const {lgui, View, pick, format, t, P} = await setup();
  try {
    const wallet = lgui.Model({gold: 0});
    class MainView extends View { static component = P; static layer = 'page'; bind = {gold: {text: pick(wallet, s => s.gold, format.number), roll: {duration: 500}}}; }
    await t.open(MainView);
    assert.equal(t.text(`${P}.gold`), '0');
    wallet.set({gold: 1000});
    await t.advance(250);
    assert.equal(t.text(`${P}.gold`), '750', 'Quad.Out 走到一半时是 75%');
    assert.equal(t.snapshot().views[0].tweens, 1, '滚动中算一个补间');
    await t.advance(250);
    assert.equal(t.text(`${P}.gold`), '1,000');
    assert.equal(t.snapshot().views[0].tweens, 0);
    wallet.set({gold: 2000});
    await t.advance(250);
    assert.equal(t.text(`${P}.gold`), '1,750');
    wallet.set({gold: 0}); // 从 1750 接着滚，重新计时
    await t.advance(250);
    assert.equal(t.text(`${P}.gold`), '438');
    await t.advance(250);
    assert.equal(t.text(`${P}.gold`), '0');
    t.end();
  } finally { teardown(); }
});

test('roll 用在进度条上；写错报 LGUI-RT-284（没配 text / progress、不是 pick、不是数字、写在 ItemView 里）', async () => {
  const {lgui, View, ItemView, pick, t, P} = await setup();
  try {
    const hero = lgui.Model({exp: 20, name: 'x'});
    class ExpView extends View { static component = P; static layer = 'page'; bind = {bar: {progress: pick(hero, s => s.exp), roll: {duration: 400, ease: 'Linear'}}}; }
    await t.open(ExpView);
    assert.equal(t.value(`${P}.bar`), 20);
    hero.set({exp: 60});
    await t.advance(200);
    assert.equal(t.value(`${P}.bar`), 40);
    await t.advance(200);
    assert.equal(t.value(`${P}.bar`), 60);
    t.end();
    const open = async bind => { class Bad extends View { static component = P; static layer = 'page'; bind = bind; } await assert.rejects(t.open(Bad), /LGUI-RT-284/); t.end(); };
    await open({coin: {roll: {duration: 100}}});
    await open({gold: {text: '1', roll: {duration: 100}}});
    await open({gold: {text: pick(hero, s => s.name), roll: {duration: 100}}});
    await open({gold: {text: pick(hero, s => String(s.exp)), roll: {duration: -1}}});
    class Slot extends ItemView { static component = 'Bag/ItemSlot'; bind = {count: {text: it => String(it), roll: {duration: 100}}}; }
    await open({list: {items: pick(hero, () => [1]), item: Slot}});
  } finally { teardown(); }
});

test('道具逐个弹出：from 马上生效、delay 按序号错开；全部放完才 resolve，await 后面的一步接着走', async () => {
  const {lgui, View, ItemView, pick, t, P} = await setup();
  try {
    const rewards = lgui.Model({pending: ['a', 'b', 'c']});
    class RewardItem extends ItemView { static component = 'Bag/Reward'; }
    class RewardView extends View {
      static component = P; static layer = 'popup';
      bind = {rewards: {items: pick(rewards, s => s.pending), item: RewardItem}};
      async onOpen() {
        await this.tween(this.itemsOf(this.ui.rewards), {scale: 1}, {from: {scale: 0}, duration: 250, ease: 'Back.Out', delay: i => i * 80});
        await this.tween(this.ui.coin, {alpha: 1}, {from: {alpha: 0}, duration: 150});
      }
    }
    await t.open(RewardView);
    assert.equal(t.look(`${P}.rewards[2]`).scaleX, 0, 'from 马上生效');
    await t.advance(100);
    assert.ok(t.look(`${P}.rewards[0]`).scaleX > 0);
    assert.equal(t.look(`${P}.rewards[2]`).scaleX, 0, '还在 delay 里');
    assert.equal(t.look(`${P}.coin`).alpha, 1, '第二步还没开始');
    await t.advance(1000);
    for (const i of [0, 1, 2]) assert.equal(t.look(`${P}.rewards[${i}]`).scaleX, 1);
    assert.equal(t.look(`${P}.coin`).alpha, 1);
    assert.equal(t.snapshot().views[0].tweens, 0);
    t.end();
  } finally { teardown(); }
});

test('按钮 downEffect="scale"：按下 50 毫秒缩到 downEffectValue，松开 100 毫秒弹回；没绑 click 也有', async () => {
  const {View, t, P} = await setup();
  try {
    class ShopView extends View { static component = P; static layer = 'page'; }
    await t.open(ShopView);
    assert.equal(t.look(`${P}.claim`).scaleX, 1);
    await t.click(`${P}.claim`); // 按住 50 毫秒再松开
    const released = t.look(`${P}.claim`).scaleX;
    assert.ok(released < 1 && released >= 0.79, `松开那一刻还是缩小的（${released}）`);
    await t.advance(70);
    assert.ok(t.look(`${P}.claim`).scaleX > 1, 'Back.Out 冲过头一点');
    await t.advance(30);
    assert.equal(t.look(`${P}.claim`).scaleX, 1);
    assert.equal(t.look(`${P}.claim`).dx, 0, '只是视觉效果，位置不变');
    t.end();
  } finally { teardown(); }
});

test('钱不够时价格闪红两下（color + repeat + yoyo），最后是原来的颜色', async () => {
  const {lgui, View, t, P} = await setup();
  try {
    const notEnough = lgui.defineEvent('tween.notEnoughGold');
    class ShopView extends View { static component = P; static layer = 'page'; onOpen() { this.on(notEnough, () => this.tween(this.ui.price, {color: '#ff3b30'}, {duration: 120, repeat: 3, yoyo: true})); } }
    await t.open(ShopView);
    const normal = t.look(`${P}.price`).color;
    assert.equal(normal, '#ffffff');
    lgui.emit(notEnough, {});
    await t.advance(120);
    assert.equal(t.look(`${P}.price`).color, '#ff3b30');
    await t.advance(360);
    assert.equal(t.look(`${P}.price`).color, normal);
    t.end();
  } finally { teardown(); }
});

test('倒计时：tick 定时重算；被盖住时不重算，露出来马上是对的', async () => {
  const {lgui, View, pick, format, CoverView, t, P} = await setup();
  try {
    const ev = lgui.Model({endsAt: lgui.time.now() + 65_000});
    let computed = 0;
    class EventView extends View { static component = P; static layer = 'page'; bind = {timer: {text: pick(ev, s => s.endsAt, at => { computed++; return format.duration(at - lgui.time.now()); }), tick: 1000}}; }
    await t.open(EventView);
    assert.equal(t.text(`${P}.timer`), '01:05');
    await t.advance(1000);
    assert.equal(t.text(`${P}.timer`), '01:04');
    await t.open(CoverView);
    const before = computed;
    await t.advance(30_000);
    assert.equal(computed, before, '盖住时不重算');
    lgui.ui.close(CoverView);
    assert.equal(t.text(`${P}.timer`), '00:34', '露出来马上重算一次');
    await t.advance(36_000);
    assert.equal(t.text(`${P}.timer`), '00:00');
    t.end();
  } finally { teardown(); }
});

test('format.duration：clock 是 05:09、满 1 小时 1:02:03；units 取最大的两个单位；向上取整到秒，负数当 0', async () => {
  const {format, lgui, t} = await setup();
  try {
    assert.deepEqual([format.duration(309_000), format.duration(3_723_000), format.duration(1), format.duration(-5000), format.duration(0)], ['05:09', '1:02:03', '00:01', '00:00', '00:00']);
    assert.deepEqual([format.duration(93_600_000, 'units'), format.duration(309_000, 'units'), format.duration(86_400_000, 'units'), format.duration(500, 'units'), format.duration(0, 'units')], ['1天2小时', '5分9秒', '1天', '1秒', '0秒']);
    await lgui.setLanguage('en');
    assert.equal(format.duration(93_600_000, 'units'), '1d 2h');
    assert.throws(() => format.duration(1, 'long'), /LGUI-RT-285/);
    t.end();
  } finally { teardown(); }
});

test('打字机（chars）：只露出前几个字；complete 跳到全文并 resolve；换句以后从头打；富文本的 UBB 标签整段带上', async () => {
  const {lgui, View, pick, t, P} = await setup();
  try {
    const story = lgui.Model({line: '你好，旅行者。', rich: '[color=#ff0000]红[/color]色'});
    const reveal = lgui.defineEvent('tween.reveal');
    const next = lgui.defineEvent('tween.next');
    const shown = [];
    class StoryView extends View {
      static component = P; static layer = 'page';
      bind = {line: {text: pick(story, s => s.line)}, rich: {text: pick(story, s => s.rich)}};
      onOpen() {
        this.on(reveal, () => this.stopTweens(this.ui.line, {complete: true}));
        this.on(next, () => { story.set({...story.get(), line: '再见。'}); void this.type(); });
        void this.type();
      }
      async type() {
        const n = this.ui.line.text.length;
        await this.tween(this.ui.line, {chars: n}, {from: {chars: 0}, duration: n * 40, ease: 'Linear'});
        shown.push(this.ui.line.text);
      }
    }
    const view = await t.open(StoryView);
    await t.advance(120);
    assert.equal(t.text(`${P}.line`), '你好，');
    lgui.emit(reveal, {});
    await t.advance(0);
    assert.equal(t.text(`${P}.line`), '你好，旅行者。');
    assert.deepEqual(shown, ['你好，旅行者。'], 'complete 也算放完');
    lgui.emit(next, {});
    assert.equal(t.text(`${P}.line`), '', '下一句从头打');
    await t.advance(200);
    assert.equal(t.text(`${P}.line`), '再见。');
    // 富文本：只数看得见的字（2 个），标签整段带上（紧跟着的结束标签也带上，不留半截）；终值 1 少于字数，放完停在露出 1 个字
    await view.tween(view.ui.rich, {chars: 1}, {from: {chars: 0}, duration: 0});
    assert.equal(t.text(`${P}.rich`), '[color=#ff0000]红[/color]');
    // 没有 chars 补间在走时文字换了：恢复全部显示
    story.set({...story.get(), rich: '[b]粗[/b]体'});
    assert.equal(t.text(`${P}.rich`), '[b]粗[/b]体');
    t.end();
  } finally { teardown(); }
});

test('抖动：dx 来回 6 轮回到原位；duration: 0 马上到终值；空数组马上 resolve', async () => {
  const {View, t, P} = await setup();
  try {
    class LoginView extends View { static component = P; static layer = 'page'; }
    const view = await t.open(LoginView);
    let done = false;
    void view.tween(view.ui.price, {dx: 10}, {duration: 40, repeat: 5, yoyo: true, ease: 'Sine.InOut'}).then(() => { done = true; });
    await t.advance(60);
    assert.notEqual(t.look(`${P}.price`).dx, 0);
    await t.advance(200);
    assert.equal(t.look(`${P}.price`).dx, 0);
    assert.equal(done, true);
    await view.tween(view.ui.coin, {alpha: 0.5, dy: -20}, {duration: 0});
    assert.deepEqual([t.look(`${P}.coin`).alpha, t.look(`${P}.coin`).dy], [0.5, -20]);
    await view.tween([], {alpha: 1}, {duration: 100});
    t.end();
  } finally { teardown(); }
});

test('被全屏界面盖住时暂停（delay 也停），露出来接着走；被弹窗压住照常走', async () => {
  const {View, CoverView, t, P} = await setup();
  try {
    class MainView extends View { static component = P; static layer = 'page'; }
    class Popup extends View { static component = 'Common/Confirm'; static layer = 'popup'; }
    const view = await t.open(MainView);
    void view.tween(view.ui.coin, {alpha: 0}, {duration: 400, ease: 'Linear', delay: 100});
    await t.advance(200);
    assert.equal(t.look(`${P}.coin`).alpha, 0.75);
    await t.open(CoverView);
    await t.advance(500);
    assert.equal(t.look(`${P}.coin`).alpha, 0.75, '盖住时不走');
    t.snapshot();
    await t.open(Popup); // 弹窗压在 CoverView 上面，不影响下面
    t.end();
    const again = await t.open(MainView);
    void again.tween(again.ui.coin, {alpha: 0}, {duration: 400, ease: 'Linear'});
    await t.open(Popup);
    await t.advance(400);
    assert.equal(t.look(`${P}.coin`).alpha, 0, '被弹窗压住但没盖住：照常走');
    t.end();
  } finally { teardown(); }
});

test('界面关闭：全部停掉、不 resolve，碰过的属性还原成 ui/ 里的样子（缓存的组件再打开是原样）', async () => {
  const {lgui, View, t, P} = await setup({config: {uiCache: {keepClosedViews: 1}}});
  try {
    let resolved = false;
    class MainView extends View { static component = P; static layer = 'page'; onOpen() { void this.tween(this.ui.coin, {scale: 0.5, dx: 30, alpha: 0.2}, {duration: 300}).then(() => { resolved = true; }); } }
    await t.open(MainView);
    await t.advance(150);
    lgui.ui.close(MainView);
    assert.equal(t.snapshot().views.length, 0);
    await t.advance(500);
    assert.equal(resolved, false);
    const view = await t.open(MainView);
    view.stopTweens();
    assert.deepEqual([t.look(`${P}.coin`).scaleX, t.look(`${P}.coin`).dx, t.look(`${P}.coin`).alpha], [1, 0, 1], '缓存的组件是原样');
    t.end();
  } finally { teardown(); }
});

test('旋转重建：正在走的补间按路径换到新组件上接着走，await 后面的一步也执行；已经放完的不带过去', async () => {
  const {lgui, View, ItemView, pick, t, P} = await setup();
  try {
    const rewards = lgui.Model({pending: ['a', 'b', 'c']});
    let finished = false;
    class RewardItem extends ItemView { static component = 'Bag/Reward'; }
    class RewardView extends View {
      static component = P; static layer = 'page';
      bind = {rewards: {items: pick(rewards, s => s.pending), item: RewardItem}};
      async onOpen() {
        void this.tween(this.ui.corner, {dx: 40}, {duration: 0});
        await this.tween(this.itemsOf(this.ui.rewards), {scale: 1}, {from: {scale: 0}, duration: 400, delay: i => i * 80});
        await this.tween(this.ui.coin, {alpha: 0.5}, {duration: 100});
        finished = true;
      }
    }
    await t.open(RewardView);
    await t.advance(100);
    await t.setScreen(1080, 1920); // 换竖版（等 200 毫秒）
    assert.ok(t.look(`${P}.rewards[2]`).scaleX > 0 && t.look(`${P}.rewards[2]`).scaleX < 1, '新组件上接着走，进度不变');
    assert.equal(t.look(`${P}.corner`).dx, 0, '放完的样子不带过去');
    await t.advance(1000);
    for (const i of [0, 1, 2]) assert.equal(t.look(`${P}.rewards[${i}]`).scaleX, 1);
    assert.deepEqual([finished, t.look(`${P}.coin`).alpha], [true, 0.5]);
    t.end();
  } finally { teardown(); }
});

test('循环：repeat: -1 一直走；complete 跳回这一轮的起点并 resolve；不带 complete 停在当前值、不 resolve', async () => {
  const {View, t, P} = await setup();
  try {
    class MainView extends View { static component = P; static layer = 'page'; }
    const view = await t.open(MainView);
    let looped = false, stopped = false;
    void view.tween(view.ui.coin, {scale: 1.05}, {duration: 750, ease: 'Sine.InOut', repeat: -1, yoyo: true}).then(() => { looped = true; });
    await t.advance(10_000);
    assert.equal(t.snapshot().views[0].tweens, 1, '还在走');
    await t.advance(600); // 10.6 秒：第 15 轮（序号 14，正着走的一轮，起点是 1）
    view.stopTweens(view.ui.coin, {complete: true});
    await t.advance(0);
    assert.equal(looped, true);
    assert.equal(t.look(`${P}.coin`).scaleX, 1, '跳回这一轮的起点');
    void view.tween(view.ui.coin, {alpha: 0}, {duration: 400, ease: 'Linear'}).then(() => { stopped = true; });
    await t.advance(200);
    view.stopTweens(view.ui.coin);
    await t.advance(400);
    assert.deepEqual([t.look(`${P}.coin`).alpha, stopped], [0.5, false]);
    t.end();
  } finally { teardown(); }
});

test('同一属性后来的接管：从当前值接着走，旧补间交出这一项，别的属性照走；全交出去的不 resolve', async () => {
  const {View, t, P} = await setup();
  try {
    class MainView extends View { static component = P; static layer = 'page'; }
    const view = await t.open(MainView);
    const done = [];
    void view.tween(view.ui.coin, {alpha: 0, dx: 100}, {duration: 400, ease: 'Linear'}).then(() => done.push('first'));
    await t.advance(200);
    void view.tween(view.ui.coin, {alpha: 1}, {duration: 200, ease: 'Linear'}).then(() => done.push('second'));
    assert.equal(t.look(`${P}.coin`).alpha, 0.5, '从当前值接着走，看不出跳变');
    await t.advance(200);
    assert.deepEqual([t.look(`${P}.coin`).alpha, t.look(`${P}.coin`).dx], [1, 100]);
    assert.deepEqual(done.sort(), ['first', 'second'], '第一个还有 dx，照常放完');
    void view.tween(view.ui.coin, {scale: 1.3}, {duration: 400}).then(() => done.push('third'));
    await t.advance(100);
    void view.tween(view.ui.coin, {scale: 1}, {duration: 100});
    await t.advance(500);
    assert.equal(done.includes('third'), false, '属性全交出去了：不 resolve');
    t.end();
  } finally { teardown(); }
});

test('列表换数据：子项上的补间跳到终值（算放完）', async () => {
  const {lgui, View, ItemView, pick, t, P} = await setup();
  try {
    const rewards = lgui.Model({pending: ['a', 'b']});
    let done = false;
    class RewardItem extends ItemView { static component = 'Bag/Reward'; }
    class RewardView extends View {
      static component = P; static layer = 'page';
      bind = {rewards: {items: pick(rewards, s => s.pending), item: RewardItem}};
      onOpen() { void this.tween(this.itemsOf(this.ui.rewards), {scale: 1}, {from: {scale: 0}, duration: 400}).then(() => { done = true; }); }
    }
    await t.open(RewardView);
    await t.advance(100);
    rewards.set({pending: ['a']});
    await t.advance(0);
    assert.deepEqual([done, t.look(`${P}.rewards[0]`).scaleX], [true, 1]);
    t.end();
  } finally { teardown(); }
});

test('一个属性一个主人（LGUI-RT-282）：齿轮、按钮的 downEffect、正在放的 ui/ 动效（两个方向都查）、绑定的 progress', async () => {
  const {lgui, View, pick, t, P} = await setup();
  try {
    const hero = lgui.Model({exp: 10, blink: false});
    class MainView extends View { static component = P; static layer = 'page'; bind = {bar: {progress: pick(hero, s => s.exp)}, blink: {playing: pick(hero, s => s.blink)}}; }
    const view = await t.open(MainView);
    const owned = (run, by) => assert.throws(run, e => e.code === 'LGUI-RT-282' && by.test(e.message), by);
    owned(() => view.tween(view.ui.geared, {scale: 1.2}, {duration: 100}), /gearSize/);
    owned(() => view.tween(view.ui.claim, {scale: 1.2}, {duration: 100}), /downEffect="scale"/); // 先查主人，再查轴心
    owned(() => view.tween(view.ui['dark.title'], {color: '#ff0000'}, {duration: 100}), /downEffect="dark"/);
    owned(() => view.tween(view.ui.bar, {progress: 50}, {duration: 100}), /progress/);
    hero.set({...hero.get(), blink: true});
    owned(() => view.tween(view.ui.coin, {alpha: 0}, {duration: 100}), /blink/);
    hero.set({...hero.get(), blink: false});
    void view.tween(view.ui.coin, {alpha: 0}, {duration: 1000});
    assert.throws(() => hero.set({...hero.get(), blink: true}), e => e.code === 'LGUI-RT-282', '绑定开始放动效时反过来查');
    view.stopTweens();
    assert.equal(t.finish(false), null, '故意写错的都记了 error 日志：只收尾，不再查日志');
  } finally { teardown(); }
});

test('写错了：参数 LGUI-RT-280、目标 LGUI-RT-281、轴心 (0, 0) 上补缩放或旋转 LGUI-RT-283', async () => {
  const {View, t, P} = await setup();
  try {
    const {lgui, pick, ItemView} = globalThis.__tween;
    const bag = lgui.Model({items: [1, 2]});
    class Slot extends ItemView { static component = 'Bag/ItemSlot'; }
    class MainView extends View { static component = P; static layer = 'page'; bind = {list: {items: pick(bag, s => s.items), item: Slot}}; }
    class Other extends View { static component = 'Common/Toast'; static layer = 'toast'; }
    const view = await t.open(MainView);
    const other = await t.open(Other);
    const code = (c, run) => assert.throws(run, e => e.code === c, c);
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {alpha: 1}, {}));
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {alpha: 1}, {duration: -1}));
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {alpha: 2}, {duration: 1}));
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {scale: 1, scaleX: 1}, {duration: 1}));
    code('LGUI-RT-280', () => view.tween(view.ui.price, {color: 'red'}, {duration: 1}));
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {color: '#ff0000', fontSize: 20}, {duration: 1}), '图片没有字号');
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {fillAmount: 0.5}, {duration: 1}), '没设填充方式');
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {alpha: 1}, {duration: 1, ease: 'Quad.Fast'}));
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {alpha: 1}, {duration: 1, from: {dx: 3}}));
    code('LGUI-RT-280', () => view.tween(view.ui.coin, {skew: 1}, {duration: 1}));
    code('LGUI-RT-281', () => view.tween(other.ui.text, {alpha: 0}, {duration: 1}));
    code('LGUI-RT-281', () => view.itemsOf(view.ui.list)); // 绑了 items 的可滚动列表是虚拟列表
    code('LGUI-RT-283', () => view.tween(view.ui.corner, {scale: 2}, {duration: 1}));
    code('LGUI-RT-283', () => view.tween(view.ui.corner, {rotation: 90}, {duration: 1}));
    await view.tween(view.ui.cool, {fillAmount: 0.25}, {duration: 0});
    assert.equal(t.look(`${P}.cool`).fillAmount, 0.25);
    assert.equal(t.finish(false), null, '故意写错的都记了 error 日志：只收尾，不再查日志');
  } finally { teardown(); }
});

test('正式构建：写错时记 error 日志、这次调用不生效（不抛）', async () => {
  const {fw, View, t, P} = await setup({production: true});
  try {
    assert.equal(fw.devMode(), false);
    class MainView extends View { static component = P; static layer = 'page'; }
    const view = await t.open(MainView);
    const result = view.tween(view.ui.corner, {scale: 2}, {duration: 1});
    assert.ok(result instanceof Promise);
    assert.deepEqual([t.snapshot().views[0].tweens, t.look(`${P}.corner`).scaleX], [0, 1], '这次调用不生效');
    assert.throws(() => t.end(), /LGUI-RT-176.*LGUI-RT-283/, '记了 error 级的日志（lgui test 里让测试失败）');
  } finally { teardown(); }
});
