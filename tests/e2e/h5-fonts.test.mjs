// h5 项目字体：backend.init 在创建任何界面之前用 FontFace 加载好 ui/fonts/ 的子集（WOFF2），文字按字体名画出来；
// 字体文件拿不到时报 LGUI-RT-180，不悄悄换成系统字体。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture} from '../helpers/fixture.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {generateWeb, uiProjectPath} from '../../plugin/tools/lib/generate/index.mjs';
import {readUiModel} from '../../plugin/tools/lib/generate/model.mjs';
import {generateFonts} from '../../plugin/tools/lib/generate/fonts.mjs';
import {validateProject} from '../../plugin/tools/lib/project.mjs';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));
const sample = fileURLToPath(new URL('../fixtures/fonts/NotoSansSC-Sample.otf', import.meta.url));

async function build(fonts) {
  const root = writeFixture();
  fs.mkdirSync(path.join(root, 'ui/fonts'));
  fs.copyFileSync(sample, path.join(root, 'ui/fonts/Noto.otf'));
  await generateWeb(uiProjectPath(root), path.join(root, 'web/ui'));
  const project = validateProject({name: 'fonts', lguiVersion: '0.3.0', defaultFont: 'Noto', languages: ['zh-CN']});
  assert.deepEqual(await generateFonts(root, project, readUiModel(uiProjectPath(root)), path.join(root, 'web/ui/fonts'), 'woff2'), ['Noto']);
  const entry = path.join(root, 'entry.ts');
  const f = rel => JSON.stringify(path.join(fw, rel));
  fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'fonts', defaultFont: 'Noto', fonts: ${JSON.stringify(fonts)}, uiBase: '/ui'});
  // 刚启动完、还没创建界面：字体已经能用
  const readyAtInit = document.fonts.check('24px Noto', '出售');
  await backend.loadPackage('Bag');
  const panel = backend.create('Bag', 'BagPanel');
  backend.root.addChild(panel);
  Object.assign(window, {readyAtInit, panel, ready: true});
})().catch(e => { (window as any).failure = {code: e.code ?? null, message: String(e.message ?? e)}; });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', keepNames: true});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="/app.js"></script>');
  return root;
}

test('h5：项目字体在第一个界面之前加载好，文字用它画；字体 404 报 LGUI-RT-180', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    const root = await build(['Noto']);
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 15000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      const result = await page.evaluate(() => {
        const span = document.querySelector('.fgui-text');
        // 同一段字，用项目字体和浏览器的等宽字体各量一次：宽度不一样，说明画出来的确实是项目字体
        const measure = family => { const c = document.createElement('canvas').getContext('2d'); c.font = `24px ${family}`; return c.measureText('出售 Sell 123').width; };
        return {
          readyAtInit: window.readyAtInit,
          faces: [...document.fonts].map(f => [f.family, f.status]),
          family: getComputedStyle(span).fontFamily,
          noto: measure('Noto'), mono: measure('monospace')
        };
      });
      assert.equal(result.readyAtInit, true);
      assert.deepEqual(result.faces, [['Noto', 'loaded']]);
      assert.equal(result.family, 'Noto');
      assert.notEqual(Math.round(result.noto), Math.round(result.mono));
    } finally {
      await server.close();
    }

    const missing = await build(['Noto', 'Missing']);
    const server2 = await serve({'/': path.join(missing, 'web')});
    try {
      const page = await browser.newPage();
      await page.goto(server2.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 15000});
      const failure = await page.evaluate(() => window.failure ?? null);
      assert.equal(failure?.code, 'LGUI-RT-180');
      assert.match(failure.message, /项目字体 Missing 加载失败（\/ui\/fonts\/Missing\.woff2）：HTTP 404/);
    } finally {
      await server2.close();
    }
  } finally {
    await browser.close();
  }
});
