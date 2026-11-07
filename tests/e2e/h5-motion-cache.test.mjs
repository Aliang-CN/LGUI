// h5：界面被全屏界面盖住时关闭、进了界面缓存，再打开时自动播放的动效照常在走（不停在暂停的那一帧）。用真实的浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture, bagPanel} from '../helpers/fixture.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {generateWeb, generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));

// glow：自动播放、一直循环，金币文字的透明度 12 帧（500 毫秒）从 1 变到 0.2。
const motion = `  <transition name="glow" autoPlay="true" autoPlayRepeat="-1">
    <item time="0" type="Alpha" target="n0" tween="true" startValue="1" endValue="0.2" duration="12"/>
  </transition>
`;
const panel = size => bagPanel({size}).replace(/<\/component>\s*$/, `${motion}</component>\n`);

test('h5：被盖住时关闭进了缓存，再打开时自动播放的循环动效照常在走', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    const root = writeFixture(undefined, {landscape: panel('1920,1080'), portrait: panel('1080,1920')});
    await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
    const {deps} = await generateProjectTypes(root);
    const entry = path.join(root, 'entry.ts');
    const f = rel => JSON.stringify(path.join(fw, rel));
    fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
import {boot} from ${f('mvc/boot.ts')};
import {defaultConfig} from ${f('mvc/runtime.ts')};
import {lgui, View} from ${f('index.ts')};
class BagView extends View<any> { static component = 'Bag/BagPanel'; static layer = 'popup' as const; bind = {}; }
class CoverView extends View<any> { static component = 'Common/Loading'; static layer = 'modal' as const; static fullScreen = true; static bothOrientations = true; }
let component: any = null;
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'demo', defaultFont: null, uiBase: '/ui'});
  await boot(backend, {backend: 'h5', start() {}}, {...defaultConfig, uiCache: {keepClosedViews: 2}}, ${JSON.stringify(deps)}, {language: 'zh-CN', texts: {'zh-CN': {'lgui.back': '返回', 'lgui.requestFailed': '请求失败（{code}）'}}});
  Object.assign(window, {
    open: async () => { component = (await lgui.ui.open(BagView) as any).__component; },
    close: () => lgui.ui.close(BagView),
    cover: async (on: boolean) => { if (on) await lgui.ui.open(CoverView); else lgui.ui.close(CoverView); },
    alpha: () => component.child('gold').native.alpha,
    component: () => component,
    ready: true
  });
})().catch(e => { (window as any).failure = String(e); });`);
    await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><script type="module" src="/app.js"></script>');
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 20000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      // 透明度在变（隔 150 毫秒取一次，连取几次里有不一样的值）就是动效在走。
      const moving = async () => {
        const samples = [];
        for (let i = 0; i < 4; i++) { samples.push(await page.evaluate(() => window.alpha())); await page.waitForTimeout(150); }
        return new Set(samples.map(a => a.toFixed(3))).size > 1;
      };
      await page.evaluate(() => window.open());
      assert.equal(await page.evaluate(() => window.component().child('sellButton').mode), 'Common', '按钮模式按 FairyGUI 的 ButtonMode 读出来');
      assert.equal(await moving(), true, '打开时动效在走');
      const first = await page.evaluate(() => { window.firstComponent = window.component(); return true; });
      assert.equal(first, true);
      await page.evaluate(() => window.cover(true));
      assert.equal(await moving(), false, '被盖住时停住');
      await page.evaluate(() => window.close());       // 盖着的时候关掉，组件进了界面缓存
      await page.evaluate(() => window.cover(false));
      await page.evaluate(() => window.open());        // 再打开：用的是缓存里的组件
      assert.equal(await page.evaluate(() => window.component() === window.firstComponent), true, '确实复用了缓存的组件');
      assert.equal(await moving(), true, '再打开以后动效照常在走');
      assert.deepEqual(errors, []);
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }
});
