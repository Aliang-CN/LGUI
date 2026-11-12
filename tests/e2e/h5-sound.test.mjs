// h5 的声音和日志出口：ui://包名/声音名按 manifest.json 找到 ui/<包>/<资源ID>.mp3；用户点一下才解锁，之前要放的背景音乐解锁后再放；
// 没登记的声音报 LGUI-RT-170（写错了，记 error）；lgui.app({ platform: { log } }) 换掉日志出口；没配 i18nBase 时换语言报 LGUI-RT-173。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bagPanel, writeFixture} from '../helpers/fixture.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {run} from '../unit/cli/helpers.mjs';
import {generateWeb, generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));

test('h5：背景音乐解锁后才加载、放的是 manifest 里登记的文件；音效照常加载；没登记的声音记 LGUI-RT-170；没配 i18nBase 换语言报 LGUI-RT-173', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    const root = writeFixture(undefined, {sounds: true});
    await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
    const {deps} = await generateProjectTypes(root);
    const entry = path.join(root, 'entry.ts');
    const f = rel => JSON.stringify(path.join(fw, rel));
    fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
import {boot} from ${f('mvc/boot.ts')};
import {defaultConfig} from ${f('mvc/runtime.ts')};
import {lgui, View} from ${f('index.ts')};
const records: {level: string; event: string}[] = [];
const write = (level: string) => (event: string) => { records.push({level, event}); };
const log = {enabled: () => true, debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error'), child: () => log};
class MainView extends View<any> { static component = 'Bag/BagPanel'; static layer = 'page' as const; static fullScreen = true; static bothOrientations = true; static music = 'ui://Common/bgm'; }
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'demo', defaultFont: null, uiBase: '/ui'});
  await boot(backend, {backend: 'h5', platform: {log}, start() {}}, defaultConfig, ${JSON.stringify(deps)}, {language: 'zh-CN', texts: {'zh-CN': {'lgui.back': '返回', 'lgui.requestFailed': '请求失败（{code}）'}}});
  await lgui.ui.open(MainView);
  Object.assign(window, {lgui, records, ready: true});
})().catch(e => { (window as any).failure = String(e); });`);
    await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', keepNames: true});
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><script type="module" src="/app.js"></script>');
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      const requests = [];
      const errors = [];
      page.on('response', r => { if (/\.mp3$/.test(r.url())) requests.push([new URL(r.url()).pathname, r.status()]); });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 20000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      await page.waitForTimeout(300);
      assert.deepEqual(requests, [], '解锁之前不加载背景音乐');
      await page.mouse.click(10, 10);
      await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.endsWith('/ui/Common/bgm00001.mp3')), null, {timeout: 10000});
      await page.evaluate(() => window.lgui.sound.play('ui://Common/click'));
      await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.endsWith('/ui/Common/click001.mp3')), null, {timeout: 10000});
      await page.evaluate(() => window.lgui.sound.play('ui://Common/nope'));
      await page.waitForFunction(() => window.records.some(r => r.event === 'lgui_rt_170'), null, {timeout: 10000});
      const language = await page.evaluate(() => window.lgui.setLanguage('en').then(() => 'ok', e => e.code));
      assert.equal(language, 'LGUI-RT-173');
      await page.waitForTimeout(300);
      const records = await page.evaluate(() => window.records);
      assert.deepEqual(records.filter(r => r.level === 'error').map(r => r.event), ['lgui_rt_170', 'lgui_rt_173']);
      assert.ok(!records.some(r => r.event === 'lgui_rt_026'), JSON.stringify(records));
      assert.deepEqual(requests.filter(([, status]) => status !== 200), []);
      assert.ok(errors.some(e => /LGUI-RT-170/.test(e)), '开发模式里没登记的声音也报到页面上');
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }
});

test('h5 代码合成声音 synth://：默认出口报 LGUI-RT-170；自定义 platform.audio 在无 mp3 工程中出声；lgui test 与 --browser 一致记录 t.sounds / t.music', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    // 1. 真浏览器下：不带 mp3，按钮写 sound="synth://laser"，View 写 static music = 'synth://bgm'
    const panel = size => bagPanel({size}).replace('xy="0,50" size="160,56"><Button title="出售"/>', 'xy="0,740" size="160,56"><Button title="出售" sound="synth://laser" volume="60"/>');
    const root = writeFixture(undefined, {sounds: false, landscape: panel('1920,1080'), portrait: panel('1080,1920')});
    await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
    const {deps} = await generateProjectTypes(root);
    const f = rel => JSON.stringify(path.join(fw, rel));
    fs.writeFileSync(path.join(root, 'entry.ts'), `import {createH5Backend} from ${f('backends/h5/index.ts')};
import {boot} from ${f('mvc/boot.ts')};
import {defaultConfig} from ${f('mvc/runtime.ts')};
import {lgui, View} from ${f('index.ts')};
const calls: unknown[][] = [];
const audio = {
  play(url: string, volume: number) { calls.push(['play', url, volume]); },
  music(url: string | null, volume: number, fadeMs: number) { calls.push(['music', url, volume, fadeMs]); },
  setPaused(paused: boolean) { calls.push(['paused', paused]); }
};
class HudView extends View<any> {
  static component = 'Bag/BagPanel'; static layer = 'page' as const; static fullScreen = true;
  static music = 'synth://bgm';
  bind = { sellButton: { click: () => {} } };
}
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'synth-demo', defaultFont: null, uiBase: '/ui'});
  let defaultErr = '';
  backend.platform.audio.play('synth://laser', 1, err => { defaultErr = (err as {code?: string})?.code ?? String(err); });
  await boot(backend, {backend: 'h5', platform: {audio}, start() {}}, defaultConfig, ${JSON.stringify(deps)}, {language: 'zh-CN', texts: {'zh-CN': {'lgui.back': '返回', 'lgui.requestFailed': '请求失败（{code}）'}}});
  await lgui.ui.open(HudView);
  Object.assign(window, {lgui, calls, getDefaultErr: () => defaultErr, ready: true});
})().catch(e => { (window as any).failure = String(e); });`);
    await esbuild().build({entryPoints: [path.join(root, 'entry.ts')], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', keepNames: true});
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><script type="module" src="/app.js"></script>');
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 20000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      await page.waitForFunction(() => window.getDefaultErr() === 'LGUI-RT-170', null, {timeout: 5000});
      const btnBox = await page.evaluate(() => {
        const el = [...document.querySelectorAll('*')].find(e => e.textContent === '出售' && e.children.length === 0);
        const r = el.getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + r.height / 2};
      });
      await page.mouse.click(btnBox.x, btnBox.y);
      await page.waitForFunction(() => window.calls.some(c => c[0] === 'play'), null, {timeout: 5000});
      const calls = await page.evaluate(() => window.calls);
      assert.deepEqual(calls[0].slice(0, 3), ['music', 'synth://bgm', 1]);
      const playCall = calls.find(c => c[0] === 'play');
      assert.deepEqual(playCall?.slice(0, 2), ['play', 'synth://laser']);
      assert.ok(Math.abs(playCall[2] - 0.6) < 1e-6);
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }

  // 2. lgui init --code-only 工程：lgui check、lgui test、lgui test --browser 全过
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-synth-test-'));
  assert.equal((await run(['init', 'game', '--code-only'], parent)).code, 0);
  const proj = path.join(parent, 'game');
  for (const rel of ['ui/assets/Main/MainView.xml', 'ui/assets/Main/MainView@portrait.xml']) {
    const fpath = path.join(proj, rel);
    fs.writeFileSync(fpath, fs.readFileSync(fpath, 'utf8').replace('<Button title="点我"/>', '<Button title="点我" sound="synth://laser" volume="50"/>'));
  }
  const viewFile = path.join(proj, 'src/modules/main/MainView.ts');
  fs.writeFileSync(viewFile, fs.readFileSync(viewFile, 'utf8').replace('static fullScreen = true;', "static fullScreen = true;\n  static music = 'synth://bgm';"));
  const mainFile = path.join(proj, 'src/main.ts');
  fs.writeFileSync(mainFile, fs.readFileSync(mainFile, 'utf8').replace(
    "backend: 'h5',",
    "backend: 'h5',\n  platform: { audio: { play() {}, music() {}, setPaused() {} } },"
  ));
  fs.writeFileSync(path.join(proj, 'tests/main.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';

test('合成声音在 headless 和 --browser 中记录一致', async () => {
  const t = await lgui.testing.start(app);
  assert.equal(t.music(), 'synth://bgm');
  await t.click('Main/MainView.button');
  assert.deepEqual(t.sounds(), [{ url: 'synth://laser', volume: 0.5 }]);
  t.end();
});
`);
  const chk = await run(['check'], proj);
  assert.equal(chk.code, 0, chk.stdout + chk.stderr);
  const unit = await run(['test'], proj);
  assert.equal(unit.code, 0, unit.stdout + unit.stderr);
  const br = await run(['test', '--browser'], proj);
  assert.equal(br.code, 0, br.stdout + br.stderr);
});
