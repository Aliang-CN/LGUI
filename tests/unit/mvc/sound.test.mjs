// 界面声音：背景音乐（View 的 static music，栈里最上面写了 music 的界面决定）、按钮音（ui/ 里按钮的 sound，没写用 sounds.click，音量 volume 写 0 不出声）、
// 代码播放 lgui.sound.play，音乐和音效两个声道的音量和静音（能用 pick 读，自动存进本地存储）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {started} from '../../helpers/framework.mjs';
import {bagPanel, writeFixture} from '../../helpers/fixture.mjs';

// 一个记录调用的声音接口（用 lgui.app({ platform: { audio } }) 换进去）。
function spyAudio() {
  const calls = [];
  return {calls, play: (url, volume) => calls.push(['play', url, volume]), music: (url, volume, fadeMs) => calls.push(['music', url, volume, fadeMs]), setPaused: paused => calls.push(['paused', paused])};
}

const settle = sim => backend => sim.advance(backend, 0);

test('lgui.sound.play：放登记过的 ui:// 音效（headless 记下来）；音量 = 调用音量 × 音效声道音量；静音或音量 0 不放', async () => {
  const {fw, backend} = await started({root: writeFixture(undefined, {sounds: true})});
  const {lgui} = fw;
  lgui.sound.play('ui://Common/click');
  lgui.sound.play('ui://Common/click', {volume: 0.5});
  lgui.sound.setVolume('sfx', 0.5);
  lgui.sound.play('ui://Common/click', {volume: 0.5});
  lgui.sound.setMuted('sfx', true);
  lgui.sound.play('ui://Common/click');
  lgui.sound.setMuted('sfx', false);
  lgui.sound.setVolume('sfx', 0);
  lgui.sound.play('ui://Common/click');
  assert.deepEqual(backend.state.sounds, [{url: 'ui://Common/click', volume: 1}, {url: 'ui://Common/click', volume: 0.5}, {url: 'ui://Common/click', volume: 0.25}]);
});

test('ui:// 声音没登记在 ui/ 的包里报 LGUI-RT-170；lgui.sound 的参数不对报 LGUI-RT-174', async () => {
  const {fw} = await started({root: writeFixture(undefined, {sounds: true})});
  const {lgui} = fw;
  assert.throws(() => lgui.sound.play('ui://Common/clik'), e => e.code === 'LGUI-RT-170' && /ui:\/\/Common\/clik/.test(e.message));
  assert.throws(() => lgui.sound.setVolume('voice', 1), e => e.code === 'LGUI-RT-174');
  assert.throws(() => lgui.sound.setVolume('music', 2), e => e.code === 'LGUI-RT-174');
  assert.throws(() => lgui.sound.setMuted('sfx', 'yes'), e => e.code === 'LGUI-RT-174');
  assert.throws(() => lgui.sound.play('ui://Common/click', {volume: Number.NaN}), e => e.code === 'LGUI-RT-174');
});

test('声音设置：pick 能读；setVolume、setMuted 自动存进本地存储，下次启动恢复；存的东西坏了记 warn（LGUI-RT-175）并用默认值', async () => {
  const {fw, backend, deps} = await started();
  const {lgui, pick, boot, defaultConfig} = fw;
  const musicVolume = pick(lgui.sound.settings, s => s.music.volume);
  const seen = [];
  const off = musicVolume.subscribe(() => seen.push(musicVolume.get()));
  assert.deepEqual(lgui.sound.settings.get(), {music: {volume: 1, muted: false}, sfx: {volume: 1, muted: false}});
  lgui.sound.setVolume('music', 0.4);
  lgui.sound.setMuted('sfx', true);
  off();
  assert.deepEqual(seen, [0.4]);
  assert.deepEqual(JSON.parse(backend.platform.storage.get('lgui.sound')), {music: {volume: 0.4, muted: false}, sfx: {volume: 1, muted: true}});
  await boot(backend, {backend: 'headless', start() {}}, defaultConfig, deps, {texts: {}});
  assert.deepEqual(lgui.sound.settings.get(), {music: {volume: 0.4, muted: false}, sfx: {volume: 1, muted: true}});
  backend.platform.storage.set('lgui.sound', '{"music":{"volume":"loud"}}');
  await boot(backend, {backend: 'headless', start() {}}, defaultConfig, deps, {texts: {}});
  assert.deepEqual(lgui.sound.settings.get(), {music: {volume: 1, muted: false}, sfx: {volume: 1, muted: false}});
  assert.equal(backend.state.logs.filter(r => r.event === 'lgui_rt_175').at(-1).level, 'warn');
});

// 按钮：sellButton 实例上写了音效和音量；buyButton 没写（用按钮组件的，组件也没写就用 sounds.click）；quietButton 的音量写了 0。
function buttonsFixture({componentSound = ''} = {}) {
  const extra = `<component id="n5" name="buyButton" src="btn00001" xy="0,800" size="160,56"><Button title="买"/></component>
    <component id="n6" name="quietButton" src="btn00001" xy="200,800" size="160,56"><Button title="静" volume="0"/></component>`;
  const panel = size => bagPanel({size, extra}).replace('<Button title="出售"/>', '<Button title="出售" sound="ui://cmn00001click001" volume="50"/>');
  const root = writeFixture(undefined, {sounds: true, landscape: panel('1920,1080'), portrait: panel('1080,1920')});
  if (componentSound) {
    const file = `${root}/ui/assets/Bag/Btn.xml`;
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<Button/>', `<Button ${componentSound}/>`));
  }
  return root;
}

test('按钮音：ui/ 里按钮实例写的音效（带音量）优先；没写用工程配置 sounds.click；音量写 0 不出声', async () => {
  const {fw, backend, sim} = await started({root: buttonsFixture(), config: {sounds: {click: 'ui://Common/click'}}});
  const {lgui, View} = fw;
  class BagView extends View {
    static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true;
    bind = {sellButton: {click: () => {}}, buyButton: {click: () => {}}, quietButton: {click: () => {}}};
  }
  const view = await lgui.ui.open(BagView);
  for (const name of ['sellButton', 'buyButton', 'quietButton']) await sim.click(backend, view.__component.child(name));
  assert.deepEqual(backend.state.sounds, [{url: 'ui://Common/click', volume: 0.5}, {url: 'ui://Common/click', volume: 1}]);
  assert.equal(view.__component.child('sellButton').sound, 'ui://Common/click');
  assert.deepEqual([view.__component.child('quietButton').sound, view.__component.child('quietButton').soundVolume], ['', 0]);
});

test('按钮音：按钮组件自己写的音效和音量是这个组件所有实例的默认值；组件的音量写 0 时整个组件都不出声', async () => {
  for (const [componentSound, expected] of [['sound="ui://cmn00001click001" volume="80"', [{url: 'ui://Common/click', volume: 0.8}]], ['volume="0"', []]]) {
    const {fw, backend, sim} = await started({root: buttonsFixture({componentSound}), config: {sounds: {click: 'ui://Common/click'}}});
    class BagView extends fw.View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; bind = {buyButton: {click: () => {}}}; }
    const view = await fw.lgui.ui.open(BagView);
    await sim.click(backend, view.__component.child('buyButton'));
    assert.deepEqual(backend.state.sounds, expected, componentSound);
  }
});

test('背景音乐：栈里最上面写了 static music 的已打开界面决定放哪首；同一首接着放不重来；换曲固定淡入淡出；都没写就停', async () => {
  const audio = spyAudio();
  const {fw, backend, sim} = await started({app: {platform: {audio}}});
  const {lgui, View, MUSIC_FADE_MS} = fw;
  class MainView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static music = 'ui://Common/bgm'; }
  class ShopView extends View { static component = 'Bag/Header'; static layer = 'page'; static music = 'ui://Common/bgm'; }
  class BattleView extends View { static component = 'Bag/ItemSlot'; static layer = 'popup'; static music = 'ui://Common/battle'; }
  class TipView extends View { static component = 'Bag/Bar'; static layer = 'modal'; }
  class ToastLike extends View { static component = 'Bag/RedDot'; static layer = 'toast'; static music = 'ui://Common/battle'; }
  const music = () => audio.calls.filter(c => c[0] === 'music');
  await lgui.ui.open(ShopView);
  await lgui.ui.open(ToastLike);
  assert.deepEqual(music(), [['music', 'ui://Common/bgm', 1, MUSIC_FADE_MS]], 'toast 层不算');
  await lgui.ui.open(BattleView);
  await lgui.ui.open(TipView);
  assert.deepEqual(music().at(-1), ['music', 'ui://Common/battle', 1, MUSIC_FADE_MS], '没写 music 的界面不影响');
  lgui.ui.close(BattleView);
  await settle(sim)(backend);
  assert.deepEqual(music().at(-1), ['music', 'ui://Common/bgm', 1, MUSIC_FADE_MS]);
  await lgui.ui.replace(MainView);
  await settle(sim)(backend);
  assert.equal(music().length, 3, 'replace 成放同一首的界面：接着放，不重来');
  lgui.ui.closeAll('page');
  await settle(sim)(backend);
  assert.deepEqual(music().at(-1), ['music', null, 1, MUSIC_FADE_MS]);
  assert.ok(MUSIC_FADE_MS > 0 && MUSIC_FADE_MS <= 1000);
});

test('背景音乐：音乐声道的音量和静音只调音量，不重来；切到后台暂停，回来恢复；headless 记下当前的音乐', async () => {
  const {fw, backend, sim} = await started({root: writeFixture(undefined, {sounds: true})});
  const {lgui, View} = fw;
  class MainView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static music = 'ui://Common/bgm'; }
  await lgui.ui.open(MainView);
  assert.deepEqual(backend.state.music, {url: 'ui://Common/bgm', volume: 1});
  lgui.sound.setVolume('music', 0.3);
  assert.deepEqual(backend.state.music, {url: 'ui://Common/bgm', volume: 0.3});
  lgui.sound.setMuted('music', true);
  assert.deepEqual(backend.state.music, {url: 'ui://Common/bgm', volume: 0});
  backend.state.handlers.visibility.emit(false);
  assert.equal(backend.state.audioPaused, true);
  backend.state.handlers.visibility.emit(true);
  assert.equal(backend.state.audioPaused, false);
  lgui.ui.close(MainView);
  await sim.advance(backend, 0);
  assert.equal(backend.state.music, null);
});

test('View 的 static music：只能写 ui://包名/声音名 或 synth://名字；ItemView、PartView 不能写', async () => {
  const {fw} = await started();
  const {View, ItemView, validateViewClass} = fw;
  class Good extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static music = 'ui://Common/bgm'; }
  validateViewClass(Good);
  class GoodSynth extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static music = 'synth://bgm/menu'; }
  validateViewClass(GoodSynth);
  class Bad extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static music = 'bgm.mp3'; }
  assert.throws(() => validateViewClass(Bad), e => e.code === 'LGUI-RT-060' && /music/.test(e.message));
  class BadSynth extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static music = 'synth://'; }
  assert.throws(() => validateViewClass(BadSynth), e => e.code === 'LGUI-RT-060' && /music/.test(e.message));
  class Item extends ItemView { static component = 'Bag/ItemSlot'; static music = 'ui://Common/bgm'; }
  assert.throws(() => validateViewClass(Item), e => e.code === 'LGUI-RT-061');
});

test('代码合成声音 synth://：自定义 platform.audio 收到按钮音、sounds.click、static music 和 lgui.sound.play；headless 原样记下合法地址，非法地址报 LGUI-RT-170', async () => {
  const extra = '<component id="n5" name="buyButton" src="btn00001" xy="0,800" size="160,56"><Button title="买"/></component>';
  const panel = size => bagPanel({size, extra}).replace('<Button title="出售"/>', '<Button title="出售" sound="synth://laser" volume="50"/>');
  const root = writeFixture(undefined, {sounds: false, landscape: panel('1920,1080'), portrait: panel('1080,1920')});
  const audio = spyAudio();
  const {fw, backend, sim} = await started({root, config: {sounds: {click: 'synth://click'}}, app: {platform: {audio}}});
  const {lgui, View, MUSIC_FADE_MS} = fw;
  class HudView extends View {
    static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static music = 'synth://bgm/space';
    bind = {sellButton: {click: () => {}}, buyButton: {click: () => {}}};
  }
  const view = await lgui.ui.open(HudView);
  await sim.click(backend, view.__component.child('sellButton'));
  await sim.click(backend, view.__component.child('buyButton'));
  lgui.sound.setVolume('sfx', 0.4);
  lgui.sound.play('synth://explosion', {volume: 0.5});
  assert.deepEqual(audio.calls, [
    ['music', 'synth://bgm/space', 1, MUSIC_FADE_MS],
    ['play', 'synth://laser', 0.5],
    ['play', 'synth://click', 1],
    ['play', 'synth://explosion', 0.2]
  ]);

  // headless（lgui test 默认不换 platform）：记入 state.sounds / state.music；非法 synth:// 报 LGUI-RT-170
  const headlessRun = await started({root, config: {sounds: {click: 'synth://click'}}});
  class HeadlessHud extends headlessRun.fw.View {
    static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static music = 'synth://bgm/space';
    bind = {sellButton: {click: () => {}}, buyButton: {click: () => {}}};
  }
  const hv = await headlessRun.fw.lgui.ui.open(HeadlessHud);
  await headlessRun.sim.click(headlessRun.backend, hv.__component.child('sellButton'));
  await headlessRun.sim.click(headlessRun.backend, hv.__component.child('buyButton'));
  assert.deepEqual(headlessRun.backend.state.music, {url: 'synth://bgm/space', volume: 1});
  assert.deepEqual(headlessRun.backend.state.sounds, [{url: 'synth://laser', volume: 0.5}, {url: 'synth://click', volume: 1}]);
  assert.throws(() => headlessRun.fw.lgui.sound.play('synth://'), e => e.code === 'LGUI-RT-170');
  assert.throws(() => headlessRun.fw.lgui.sound.play('synth://bad name'), e => e.code === 'LGUI-RT-170');
});

test('背景音乐：正在打开的界面也算（replace 不断）；它打开失败离开界面栈后重新选曲', async () => {
  const audio = spyAudio();
  const {fw, backend, sim} = await started({app: {platform: {audio}}});
  const {lgui, View} = fw;
  class ShopView extends View { static component = 'Bag/Header'; static layer = 'page'; static music = 'ui://Common/bgm'; }
  class BattleView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static music = 'ui://Common/battle'; onOpen() { throw new Error('坏了'); } }
  await lgui.ui.open(ShopView);
  await assert.rejects(lgui.ui.replace(BattleView), e => e.code === 'LGUI-RT-080');
  await sim.advance(backend, 0);
  assert.deepEqual(audio.calls.filter(c => c[0] === 'music').map(c => c[1]), ['ui://Common/bgm', 'ui://Common/battle', null]);
});
