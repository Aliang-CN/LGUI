// 网页端三维画布与界面共存（host/main.ts、lgui/host、FairyGUI-dom 补丁 14、inputMode 分流）端到端测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';
import {startDev} from '../../plugin/tools/lib/dev/index.mjs';
import {readProject} from '../../plugin/tools/lib/project.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {run} from '../unit/cli/helpers.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const h5 = path.join(repo, 'plugin/framework/backends/h5');

test('FairyGUI-dom 补丁 14：先复现 opaque = false 容器设 touchable = false 时子控件仍可点的缺陷，再验证补丁修好', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-patch14-'));
  try {
    for (const patched of [false, true]) {
      const sub = path.join(dir, patched ? 'patched' : 'raw');
      fs.mkdirSync(sub, {recursive: true});
      const entry = path.join(sub, 'entry.ts');
      fs.writeFileSync(entry, `
import * as fgui from ${JSON.stringify(path.join(h5, 'vendor/fairygui.module.js'))};
import {installFairyGuiPatches} from ${JSON.stringify(path.join(h5, 'fairygui-patches/index.ts'))};
if (${patched}) installFairyGuiPatches();
const root = fgui.GRoot.inst;
root.opaque = false;
const layer = new fgui.GComponent();
layer.opaque = false;
layer.setSize(400, 300);
root.addChild(layer);
const hud = new fgui.GComponent();
hud.opaque = false;
hud.setSize(400, 300);
layer.addChild(hud);
const hit = new fgui.GComponent();
hit.setSize(100, 60);
hud.addChild(hit);
layer.touchable = false;
const disabledPointerEvents = getComputedStyle(hit.element).pointerEvents;
layer.touchable = true;
const enabledPointerEvents = getComputedStyle(hit.element).pointerEvents;
(window as unknown as {result: unknown}).result = {disabledPointerEvents, enabledPointerEvents};
`);
      await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(sub, 'app.js'), logLevel: 'silent'});
      fs.writeFileSync(path.join(sub, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module" src="./app.js"></script></body>');
      const server = await serve({'/': sub});
      try {
        const page = await browser.newPage({viewport: {width: 400, height: 300}});
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${server.url}/index.html`);
        await page.waitForFunction(() => Boolean(window.result), null, {timeout: 5000});
        assert.deepEqual(errors, []);
        const result = await page.evaluate(() => window.result);
        await page.close();
        if (!patched) {
          assert.equal(result.disabledPointerEvents, 'auto', '未打补丁时 opaque=false 容器禁点后子控件仍是 auto');
        } else {
          assert.equal(result.disabledPointerEvents, 'none', '打上补丁 14 后子控件被禁点（none）');
          assert.equal(result.enabledPointerEvents, 'auto', '恢复 touchable=true 后子控件恢复可点（auto）');
        }
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('三维画布与界面共存：框架建画布垫底、尺寸安全区同步、多指与按键按 inputMode 分流、dev 热更、check/test/verify 全过', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-scene-'));
  try {
    const init = await run(['init', 'game', '--code-only'], parent);
    assert.equal(init.code, 0, init.stderr);
    const root = path.join(parent, 'game');

    // 1. 准备 HUD（layer='hud'，opaque="false"，右上角按钮打开弹窗，左下角摇杆按钮）+ 弹窗 PopupView（layer='popup'）
    for (const [file, size, openPos, stickPos] of [
      ['ui/assets/Main/MainView.xml', '1920,1080', '1600,40', '60,920'],
      ['ui/assets/Main/MainView@portrait.xml', '1080,1920', '760,40', '60,1760']
    ]) {
      fs.writeFileSync(path.join(root, file), `<?xml version="1.0" encoding="utf-8"?>
<component size="${size}" opaque="false">
  <displayList>
    <graph id="n0000001" name="safe" xy="0,0" size="${size}" touchable="false">
      <relation target="" sidePair="width-width,height-height"/>
    </graph>
    <text id="n0000002" name="status" xy="60,40" size="500,48" fontSize="28" color="#ffffff" autoSize="shrink" singleLine="true" text="">
      <relation target="n0000001" sidePair="left-left,top-top"/>
    </text>
    <component id="n0000003" name="openPopup" pkg="cmn00001" src="button01" xy="${openPos}" size="240,80">
      <relation target="n0000001" sidePair="right-right,top-top"/>
      <Button title="菜单" sound="synth://tap"/>
    </component>
    <component id="n0000004" name="stick" pkg="cmn00001" src="button01" xy="${stickPos}" size="200,100">
      <relation target="n0000001" sidePair="left-left,bottom-bottom"/>
      <Button title="攻击" sound="synth://swing"/>
    </component>
  </displayList>
</component>
`);
    }

    // 新增 Popup.xml 登记进 Main/package.xml
    fs.writeFileSync(path.join(root, 'ui/assets/Main/Popup.xml'), `<?xml version="1.0" encoding="utf-8"?>
<component size="600,400">
  <displayList>
    <graph id="n0000001" name="bg" xy="0,0" size="600,400" type="rect" lineSize="2" lineColor="#ff3b5c7a" fillColor="#ee101a28"/>
    <text id="n0000002" name="title" xy="40,40" size="520,48" fontSize="32" color="#ffffff" autoSize="shrink" singleLine="true" text="设置"/>
    <component id="n0000003" name="closeBtn" pkg="cmn00001" src="button01" xy="180,260" size="240,80">
      <Button title="关闭"/>
    </component>
  </displayList>
</component>
`);
    const pkgXml = path.join(root, 'ui/assets/Main/package.xml');
    fs.writeFileSync(pkgXml, fs.readFileSync(pkgXml, 'utf8').replace(
      '</resources>',
      '    <component id="popup001" name="Popup.xml" path="/" exported="true"/>\n  </resources>'
    ));

    // 更新 i18n
    fs.writeFileSync(path.join(root, 'i18n/zh-CN.json'), JSON.stringify({
      'lgui.back': '返回',
      'lgui.requestFailed': '请求失败（{code}）',
      'lgui.time.day': '{n}天',
      'lgui.time.hour': '{n}小时',
      'lgui.time.minute': '{n}分',
      'lgui.time.second': '{n}秒',
      'Common/Confirm/title': '提示',
      'Common/Confirm/cancel': '取消',
      'Common/Confirm/ok': '确定',
      'Common/Loading/text': '加载中…',
      'Main/MainView/openPopup': '菜单',
      'Main/MainView/stick': '攻击',
      'Main/Popup/title': '设置',
      'Main/Popup/closeBtn': '关闭',
      'hud.status': '连击 {n}',
      'hud.jump': '跳跃'
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'i18n/en.json'), JSON.stringify({
      'lgui.back': 'Back',
      'lgui.requestFailed': 'Request failed ({code})',
      'lgui.time.day': '{n}d',
      'lgui.time.hour': '{n}h',
      'lgui.time.minute': '{n}m',
      'lgui.time.second': '{n}s',
      'Common/Confirm/title': 'Notice',
      'Common/Confirm/cancel': 'Cancel',
      'Common/Confirm/ok': 'OK',
      'Common/Loading/text': 'Loading…',
      'Main/MainView/openPopup': 'Menu',
      'Main/MainView/stick': 'Attack',
      'Main/Popup/title': 'Settings',
      'Main/Popup/closeBtn': 'Close',
      'hud.status': 'Combo {n}',
      'hud.jump': 'Jump'
    }, null, 2) + '\n');

    // src/ 代码（不碰 document / window）
    fs.writeFileSync(path.join(root, 'src/modules/main/MainModel.ts'), `import { lgui } from 'lgui';

export const mainModel = lgui.Model(
  { combo: 0, jumps: 0, modeTag: 'init' },
  (set, get) => ({
    hit() { set({ combo: get().combo + 1 }); },
    jump() { set({ jumps: get().jumps + 1 }); },
    setModeTag(modeTag: string) { set({ modeTag }); },
    reset() { set({ combo: 0, jumps: 0, modeTag: 'init' }); },
  }),
);
`);
    fs.writeFileSync(path.join(root, 'src/modules/main/PopupView.ts'), `import { View, type Bind, type Keys } from 'lgui';
import type { PopupUI } from 'lgui/ui';
import { mainController } from './MainController';

export class PopupView extends View<PopupUI> {
  static component = 'Main/Popup';
  static layer = 'modal' as const;
  bind: Bind<PopupUI> = {
    closeBtn: { click: () => mainController.closePopup() },
  };
  keys: Keys = { back: 'close' };
}
`);
    fs.writeFileSync(path.join(root, 'src/modules/main/AllModeView.ts'), `import { View, pick, lgui, type Bind, type Keys } from 'lgui';
import type { MainViewUI } from 'lgui/ui';
import { mainModel } from './MainModel';
import { mainController } from './MainController';

export class AllModeView extends View<MainViewUI> {
  static component = 'Main/MainView';
  static layer = 'page' as const;
  static fullScreen = true;
  static inputMode = 'all' as const;
  bind: Bind<MainViewUI> = {
    status: { text: pick(mainModel, s => lgui.t('hud.status', { n: s.combo })) },
    openPopup: { click: () => mainController.openPopup() },
    stick: { click: () => mainController.attack() },
  };
  keys: Keys = { back: 'close' };
}
`);
    fs.writeFileSync(path.join(root, 'src/modules/main/MainView.ts'), `import { View, pick, lgui, type Bind, type Keys } from 'lgui';
import type { MainViewUI } from 'lgui/ui';
import { mainModel } from './MainModel';
import { mainController } from './MainController';

export class MainView extends View<MainViewUI> {
  static component = 'Main/MainView';
  static layer = 'hud' as const;
  static fullScreen = true;
  static music = 'synth://bgm/field';
  bind: Bind<MainViewUI> = {
    status: { text: pick(mainModel, s => lgui.t('hud.status', { n: s.combo })) },
    openPopup: { click: () => mainController.openPopup() },
    stick: { click: () => mainController.attack() },
  };
  keys: Keys = {
    back: 'none',
    confirm: { do: () => mainController.jump(), hint: 'hud.jump' },
  };
}
`);
    fs.writeFileSync(path.join(root, 'src/modules/main/MainController.ts'), `import { Controller, lgui } from 'lgui';
import { mainModel } from './MainModel';
import { PopupView } from './PopupView';

class MainController extends Controller {
  attack() { mainModel.hit(); }
  jump() { mainModel.jump(); }
  async openPopup() { await lgui.ui.open(PopupView); }
  closePopup() { lgui.ui.close(PopupView); }
}
export const mainController = new MainController();
`);
    fs.writeFileSync(path.join(root, 'tests/main.test.ts'), `import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';
import { mainModel } from '../src/modules/main/MainModel';

beforeEach(() => mainModel.reset());

test('没有三维画布时 HUD 和弹窗在 lgui test 里照常工作', async () => {
  const t = await lgui.testing.start(app);
  assert.equal(t.text('Main/MainView.status'), '连击 0');
  assert.equal(t.music(), 'synth://bgm/field');
  await t.click('Main/MainView.stick');
  assert.equal(t.text('Main/MainView.status'), '连击 1');
  assert.deepEqual(t.sounds().map(s => s.url), ['synth://swing']);
  await t.click('Main/MainView.openPopup');
  await t.advance(16);
  await t.click('Main/Popup.closeBtn');
  await t.advance(16);
  t.end();
});
`);

    // host/main.ts（同样不访问 document：只用 stage.canvas、stage.size、stage.input、Web Audio 合成桩）
    const hostCode = color => `import { defineWebHost } from 'lgui/host';
import { mainModel } from '../src/modules/main/MainModel';

const hostLog = {
  sounds: [] as string[],
  music: null as string | null,
  pointers: [] as Array<{ type: string; id: number; x: number; y: number }>,
  wheels: [] as Array<{ dx: number; dy: number }>,
  keys: [] as Array<{ type: string; key: string }>,
  modes: [] as string[],
  resizes: [] as Array<{ width: number; height: number; top: number; right: number; bottom: number; left: number }>,
  frames: 0,
  color: ${JSON.stringify(color)},
};
(globalThis as unknown as { __hostLog: typeof hostLog }).__hostLog = hostLog;

export default defineWebHost({
  audio: {
    play(url) { hostLog.sounds.push(url); },
    music(url) { hostLog.music = url; },
    setPaused() {},
  },
  mount(stage) {
    const ctx = stage.canvas.getContext('2d');
    const paint = (s = stage.size()) => {
      stage.canvas.width = Math.max(1, Math.round(s.width * s.pixelRatio));
      stage.canvas.height = Math.max(1, Math.round(s.height * s.pixelRatio));
      if (ctx) {
        ctx.fillStyle = hostLog.color;
        ctx.fillRect(0, 0, stage.canvas.width, stage.canvas.height);
      }
    };
    paint(stage.size());
    hostLog.modes.push(stage.input.mode());
    const offResize = stage.onResize(s => {
      hostLog.resizes.push({ width: s.width, height: s.height, ...s.safeArea });
      paint(s);
    });
    const offMode = stage.input.onModeChange(m => {
      hostLog.modes.push(m);
      mainModel.setModeTag(m);
    });
    const offPtr = stage.input.onPointer(e => {
      hostLog.pointers.push({ type: e.type, id: e.pointerId, x: Math.round(e.x), y: Math.round(e.y) });
    });
    const offWheel = stage.input.onWheel(e => {
      hostLog.wheels.push({ dx: e.deltaX, dy: e.deltaY });
    });
    const offKey = stage.input.onKey(e => {
      hostLog.keys.push({ type: e.type, key: e.key });
    });
    const offFrame = stage.onFrame(() => { hostLog.frames += 1; });
    return () => { offResize(); offMode(); offPtr(); offWheel(); offKey(); offFrame(); };
  },
});
`;
    fs.mkdirSync(path.join(root, 'host'), {recursive: true});
    fs.writeFileSync(path.join(root, 'host/main.ts'), hostCode('#124488'));

    // 2. lgui check、lgui test（headless）、lgui test --browser 全部通过
    const chk = await run(['check'], root);
    assert.equal(chk.code, 0, chk.stdout + chk.stderr);

    const tst = await run(['test'], root);
    assert.equal(tst.code, 0, tst.stdout + tst.stderr);

    const tstBrowser = await run(['test', '--browser'], root);
    assert.equal(tstBrowser.code, 0, tstBrowser.stdout + tstBrowser.stderr);

    // 3. lgui dev 真实浏览器验证：叠放顺序、尺寸与安全区同步、多指与按键分流、host 热更
    const server = await startDev(root, readProject(root), {port: 0});
    try {
      const page = await browser.newPage({viewport: {width: 960, height: 540}, hasTouch: true, locale: 'zh-CN'});
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.addInitScript(() => { window.__lguiSafeArea = {top: 0, right: 30, bottom: 16, left: 30}; });
      await page.goto(server.url);
      await page.waitForFunction(() => window.__lguiReady && window.__hostLog?.frames > 0, null, {timeout: 15000});
      assert.deepEqual(pageErrors, []);

      // 画布由框架创建并垫在 <fgui-stage> 底下（z-index 0 < z-index 1）
      const domOrder = await page.evaluate(() => {
        const canvas = document.querySelector('canvas.lgui-canvas');
        const stage = document.querySelector('fgui-stage');
        const centerHit = document.elementFromPoint(480, 270);
        return {
          hasCanvas: canvas instanceof HTMLCanvasElement,
          canvasBeforeStage: Boolean(canvas && stage && (canvas.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING)),
          canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
          stageZ: stage ? getComputedStyle(stage).zIndex : null,
          stagePointerEvents: stage ? getComputedStyle(stage).pointerEvents : null,
          centerHitTag: centerHit?.tagName.toLowerCase() ?? null,
          music: window.__hostLog.music
        };
      });
      assert.equal(domOrder.hasCanvas, true);
      assert.equal(domOrder.canvasBeforeStage, true);
      assert.equal(domOrder.canvasZ, '0');
      assert.equal(domOrder.stageZ, '1');
      assert.equal(domOrder.stagePointerEvents, 'none');
      assert.equal(domOrder.centerHitTag, 'canvas', 'HUD 空白处直接命中底层画布');
      assert.equal(domOrder.music, 'synth://bgm/field');

      // 视口尺寸变化同步给 stage.onResize（带 safeArea）
      await page.setViewportSize({width: 800, height: 600});
      await page.waitForFunction(() => window.__hostLog.resizes.some(r => r.width === 800 && r.height === 600), null, {timeout: 5000});
      const resized = await page.evaluate(() => window.__hostLog.resizes.at(-1));
      assert.deepEqual(resized, {width: 800, height: 600, top: 0, right: 30, bottom: 16, left: 30});
      await page.setViewportSize({width: 960, height: 540});
      await page.waitForFunction(() => window.__lgui.snapshot().orientation === 'landscape', null, {timeout: 5000});

      // 找两个 HUD 按钮的屏幕坐标
      const rects = await page.evaluate(() => {
        const centerOf = label => {
          const el = [...document.querySelectorAll('*')].find(e => e.textContent === label && e.children.length === 0);
          const r = el.getBoundingClientRect();
          return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
        };
        return {stick: centerOf('攻击'), openPopup: centerOf('菜单')};
      });

      // 'game' 模式：点空白处送给三维场景，不触发界面；点 HUD 按钮触发界面和 synth:// 音效，不送给三维场景
      await page.evaluate(() => { window.__hostLog.pointers.length = 0; window.__hostLog.sounds.length = 0; });
      await page.mouse.click(480, 270);
      await page.mouse.click(rects.stick.x, rects.stick.y);
      const afterClicks = await page.evaluate(() => ({
        pointers: window.__hostLog.pointers.filter(p => p.type === 'down' || p.type === 'up'),
        sounds: window.__hostLog.sounds,
        status: document.body.innerText.includes('连击 1')
      }));
      assert.equal(afterClicks.status, true);
      assert.deepEqual(afterClicks.sounds, ['synth://swing']);
      assert.deepEqual(afterClicks.pointers.map(p => p.type), ['down', 'up'], '只有空白处点击进了场景 onPointer，HUD 按钮点击没进');

      // 多指触控同时发生：手指 1 按在 HUD「攻击」按钮上，手指 2 同时在画布空白处拖动镜头
      const cdp = await page.context().newCDPSession(page);
      await page.evaluate(() => { window.__hostLog.pointers.length = 0; });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          {x: rects.stick.x, y: rects.stick.y, id: 1},
          {x: 480, y: 270, id: 2}
        ]
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {x: rects.stick.x, y: rects.stick.y, id: 1},
          {x: 530, y: 290, id: 2}
        ]
      });
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      const multiTouch = await page.evaluate(() => ({
        pointers: window.__hostLog.pointers,
        comboText: document.body.innerText.includes('连击 2')
      }));
      assert.equal(multiTouch.comboText, true, '手指 1 触发了 HUD 按钮');
      const touchIds = new Set(multiTouch.pointers.map(p => p.id));
      assert.equal(touchIds.size, 1, `只有一个触点（空白处手指 2）进了场景：${JSON.stringify(multiTouch.pointers)}`);
      assert.ok(multiTouch.pointers.some(p => p.type === 'down' && Math.abs(p.x - 480) <= 2));
      assert.ok(multiTouch.pointers.some(p => p.type === 'move' && Math.abs(p.x - 530) <= 2));
      assert.ok(multiTouch.pointers.some(p => p.type === 'up'));

      // 'game' 模式按键：Enter（confirm 动作）被 HUD keys 表消费（不进场景），KeyW 未被界面消费（进场景）
      await page.evaluate(() => { window.__hostLog.keys.length = 0; });
      await page.keyboard.press('Enter');
      await page.keyboard.press('KeyW');
      const gameKeys = await page.evaluate(() => window.__hostLog.keys);
      assert.deepEqual(gameKeys, [{type: 'down', key: 'w'}, {type: 'up', key: 'w'}]);

      // 场景拖动进行中打开 'ui' 弹窗：进行中的场景指针立即收到 'cancel'；弹窗打开期间 HUD 按钮被禁点（补丁 14）、空白点击不进场景；Esc 关闭弹窗不漏给场景
      await page.mouse.move(480, 270);
      await page.evaluate(() => { window.__hostLog.pointers.length = 0; window.__hostLog.keys.length = 0; });
      await page.mouse.down();
      await page.evaluate(() => window.__lgui.lgui.ui.open(window.__lgui.views.PopupView));
      await page.waitForFunction(() => document.body.innerText.includes('设置'), null, {timeout: 5000});
      const duringModal = await page.evaluate(({sx, sy}) => {
        const topAtStick = document.elementFromPoint(sx, sy);
        return {
          mode: window.__hostLog.modes.at(-1),
          pointers: [...window.__hostLog.pointers],
          topTag: topAtStick?.tagName?.toLowerCase() ?? null
        };
      }, {sx: rects.stick.x, sy: rects.stick.y});
      assert.equal(duringModal.mode, 'ui');
      assert.deepEqual(duringModal.pointers.map(p => p.type), ['down', 'cancel'], '切入 ui 模式时进行中的场景拖拽收到 cancel');
      assert.equal(duringModal.topTag, 'body', '被 modal 压住的 HUD 按钮和底层画布在 ui 模式下都禁点，落到 body');
      await page.mouse.up();

      // 在 modal 打开时点击 HUD「攻击」按钮位置、空白处和按 W 键：都不触发 HUD 按钮、不进场景；按 Escape 关闭弹窗：Escape 的 down 和 up 都不漏给场景，且模式回到 game
      await page.evaluate(() => { window.__hostLog.pointers.length = 0; window.__hostLog.keys.length = 0; });
      await page.mouse.click(rects.stick.x, rects.stick.y);
      await page.mouse.click(100, 100);
      await page.keyboard.press('KeyW');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__hostLog.modes.at(-1) === 'game', null, {timeout: 5000});
      const afterEsc = await page.evaluate(() => ({
        pointers: window.__hostLog.pointers.filter(p => p.type === 'down'),
        keys: window.__hostLog.keys,
        comboStill2: document.body.innerText.includes('连击 2')
      }));
      assert.equal(afterEsc.comboStill2, true, 'modal 打开期间点击 HUD 按钮不生效');
      assert.deepEqual(afterEsc.pointers, []);
      assert.deepEqual(afterEsc.keys, [], '关闭弹窗那一下 Escape（含 keyup）不漏给三维场景');

      // 'all' 模式：点按钮同时触发界面和场景指针
      await page.evaluate(() => window.__lgui.lgui.ui.open(window.__lgui.views.AllModeView));
      await page.waitForFunction(() => window.__hostLog.modes.at(-1) === 'all', null, {timeout: 5000});
      await page.evaluate(() => { window.__hostLog.pointers.length = 0; });
      await page.mouse.click(rects.stick.x, rects.stick.y);
      const allModeRes = await page.evaluate(() => ({
        downs: window.__hostLog.pointers.filter(p => p.type === 'down').length,
        combo3: document.body.innerText.includes('连击 3')
      }));
      assert.equal(allModeRes.combo3, true);
      assert.equal(allModeRes.downs, 1, 'all 模式下点界面按钮也同时派发给场景');

      // 改 host/main.ts，lgui dev 自动重新打包刷新
      const navigated = page.waitForEvent('framenavigated', {predicate: f => f === page.mainFrame(), timeout: 5000});
      fs.writeFileSync(path.join(root, 'host/main.ts'), hostCode('#22aa55'));
      await navigated;
      await page.waitForFunction(() => window.__lguiReady && window.__hostLog?.color === '#22aa55', null, {timeout: 5000});
      await page.close();
    } finally {
      await server.close();
    }

    // 4. lgui verify（默认带 host 画布）和 lgui verify --no-host（跳过 host，即使 synth:// 只在 host 配了 audio 也不报错）都全过
    const verWithHost = await run(['verify', '--size', 'phone-landscape', '--json'], root);
    assert.equal(verWithHost.code, 0, verWithHost.stdout + verWithHost.stderr);
    const verNoHost = await run(['verify', '--size', 'phone-landscape', '--no-host', '--json'], root);
    assert.equal(verNoHost.code, 0, verNoHost.stdout + verNoHost.stderr);
  } finally {
    await browser.close();
    fs.rmSync(parent, {recursive: true, force: true});
  }
});
