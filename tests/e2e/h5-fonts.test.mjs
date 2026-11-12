// h5 项目字体：backend.init 在创建任何界面之前用 FontFace 加载好 ui/fonts/ 的子集（WOFF2），文字按字体名画出来，
// autoSize="shrink"（补丁 8）按项目字体量宽；字体文件拿不到时报 LGUI-RT-180，不悄悄换成系统字体。
// 对照：不传 fonts 时，init 完成时没有 loaded 的项目字体，Shrink 量出来的是回退字体的宽度。
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
import {run} from '../unit/cli/helpers.mjs';
import os from 'node:os';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));
const sample = fileURLToPath(new URL('../fixtures/fonts/NotoSansSC-Sample.otf', import.meta.url));

async function build(fonts) {
  const root = writeFixture();
  fs.mkdirSync(path.join(root, 'ui/fonts'));
  fs.copyFileSync(sample, path.join(root, 'ui/fonts/Noto.otf'));
  // 一个要缩的单行文字（拉丁字母和数字：各字体宽度不同，汉字各字体都是 1 个字号宽，分不出来）、24 号，框宽 100
  const panel = path.join(root, 'ui/assets/Bag/BagPanel.xml');
  fs.writeFileSync(panel, fs.readFileSync(panel, 'utf8').replace('</displayList>', '<text id="n9" name="tip" xy="0,200" size="100,40" fontSize="24" autoSize="shrink" singleLine="true" text="Sell Gold 1234567"/>\n  </displayList>'));
  await generateWeb(uiProjectPath(root), path.join(root, 'web/ui'));
  const project = validateProject({name: 'fonts', lguiVersion: '0.3.0', defaultFont: 'Noto', languages: ['zh-CN']});
  assert.deepEqual(await generateFonts(root, project, readUiModel(uiProjectPath(root)), path.join(root, 'web/ui/fonts'), 'woff2'), ['Noto']);
  const entry = path.join(root, 'entry.ts');
  const f = rel => JSON.stringify(path.join(fw, rel));
  fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'fonts', defaultFont: 'Noto', fonts: ${JSON.stringify(fonts)}, uiBase: '/ui'});
  // 刚启动完、还没创建界面：项目字体的 FontFace 已经是 loaded
  const readyAtInit = [...document.fonts].some(f => f.family === 'Noto' && f.status === 'loaded');
  await backend.loadPackage('Bag');
  const panel = backend.create('Bag', 'BagPanel');
  backend.root.addChild(panel);
  Object.assign(window, {readyAtInit, panel, ready: true});
})().catch(e => { (window as any).failure = {code: e.code ?? null, message: String(e.message ?? e)}; });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', keepNames: true});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="/app.js"></script>');
  return root;
}

// 页面里：init 时项目字体是否 loaded；Shrink 实际缩成的字号；按项目字体、按回退字体量宽算出来应该缩成的字号（同补丁 8 的算法）
const probe = () => {
  const span = window.panel.native.getChild('tip').element._span;
  const expected = family => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `24px ${family}`;
    const m = c.measureText("Sell Gold 1234567");
    return 24 * (100 - 2 * 2) / Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  };
  return {
    readyAtInit: window.readyAtInit,
    faces: [...document.fonts].map(f => [f.family, f.status]),
    family: getComputedStyle(span).fontFamily,
    shrunk: parseFloat(span.style.fontSize),
    noto: expected('Noto'),
    fallback: expected(getComputedStyle(document.body).fontFamily)
  };
};

async function open(browser, fonts) {
  const root = await build(fonts);
  const server = await serve({'/': path.join(root, 'web')});
  const page = await browser.newPage({viewport: {width: 1280, height: 720}});
  await page.goto(server.url + '/index.html');
  await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 15000});
  return {page, server};
}

test('h5：项目字体在第一个界面之前 loaded，文字和 Shrink 都按它量；不加载时（对照）两条都不成立；字体 404 报 LGUI-RT-180', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    let notoSize;
    const {page, server} = await open(browser, ['Noto']);
    try {
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      const r = await page.evaluate(probe);
      assert.equal(r.readyAtInit, true);
      assert.deepEqual(r.faces, [['Noto', 'loaded']]);
      assert.equal(r.family, 'Noto');
      assert.ok(Math.abs(r.noto - r.fallback) > 0.3, `两种字体量出来要有差别才能区分（Noto ${r.noto}，回退 ${r.fallback}）`);
      assert.ok(Math.abs(r.shrunk - r.noto) < 0.01, `Shrink 缩成 ${r.shrunk}，按项目字体算是 ${r.noto}，按回退字体算是 ${r.fallback}`);
      notoSize = r.noto;
    } finally {
      await server.close();
    }

    // 对照：同样的界面不传 fonts。init 时没有 loaded 的 Noto，Shrink 按回退字体量
    const control = await open(browser, []);
    try {
      assert.equal(await control.page.evaluate(() => window.failure ?? null), null);
      const r = await control.page.evaluate(probe);
      assert.equal(r.readyAtInit, false);
      assert.ok(Math.abs(r.shrunk - r.fallback) < 0.01, `对照：Shrink 缩成 ${r.shrunk}，按回退字体算是 ${r.fallback}`);
      assert.ok(Math.abs(r.shrunk - notoSize) > 0.3, `对照：没加载项目字体时不该缩成按项目字体算的 ${notoSize}`);
    } finally {
      await control.server.close();
    }

    const missing = await open(browser, ['Noto', 'Missing']);
    try {
      const failure = await missing.page.evaluate(() => window.failure ?? null);
      assert.equal(failure?.code, 'LGUI-RT-180');
      assert.match(failure.message, /项目字体 Missing 加载失败（\/ui\/fonts\/Missing\.woff2）：HTTP 404/);
    } finally {
      await missing.server.close();
    }
  } finally {
    await browser.close();
  }
});

test('h5：不带字体文件（ui/fonts/ 为空、defaultFont 为 null）时统一使用无衬线系统字体栈，不拼出 font-family: undefined，check/test/verify 全过', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-sysfont-'));
  try {
    const init = await run(['init', 'game', '--code-only'], parent);
    assert.equal(init.code, 0, init.stderr);
    const root = path.join(parent, 'game');
    fs.mkdirSync(path.join(root, 'ui/fonts'), {recursive: true}); // 空的 ui/fonts/ 目录

    // 加一个输入框和生僻汉字，验证无字体文件时普通文字、输入框、Shrink 量宽一致且不报缺字
    for (const [rel, inputY] of [['ui/assets/Main/MainView.xml', '660'], ['ui/assets/Main/MainView@portrait.xml', '1080']]) {
      const full = path.join(root, rel);
      fs.writeFileSync(full, fs.readFileSync(full, 'utf8')
        .replace('text="你好，LGUI"', 'text="你好，LGUI 龘"')
        .replace('</displayList>', `    <inputtext id="n0000009" name="nick" xy="260,${inputY}" size="400,56" fontSize="28" color="#ffffff" prompt="输入昵称"/>\n  </displayList>`));
    }
    for (const [lang, title, prompt] of [['zh-CN', '你好，LGUI 龘', '输入昵称'], ['en', 'Hello, LGUI', 'Enter nickname']]) {
      const f = path.join(root, 'i18n', `${lang}.json`);
      const table = JSON.parse(fs.readFileSync(f, 'utf8'));
      table['Main/MainView/title'] = title;
      table['Main/MainView/nick@prompt'] = prompt;
      fs.writeFileSync(f, JSON.stringify(table, null, 2) + '\n');
    }

    fs.writeFileSync(path.join(root, 'tests/main.test.ts'), fs.readFileSync(path.join(root, 'tests/main.test.ts'), 'utf8').replace("'你好，LGUI'", "'你好，LGUI 龘'"));

    for (const args of [['check'], ['test'], ['test', '--browser'], ['verify', '--size', 'desktop', '--json']]) {
      const res = await run(args, root);
      assert.equal(res.code, 0, `${args.join(' ')}: ${res.stdout}${res.stderr}`);
    }

    // 直接检查 H5 舞台注入样式、文字和输入框的最终 font-family 与无字体请求
    const uiDir = path.join(root, 'web/ui');
    await generateWeb(uiProjectPath(root), uiDir);
    const entry = path.join(root, 'entry-sys.ts');
    const f = rel => JSON.stringify(path.join(fw, rel));
    fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'sysfont', defaultFont: null, fonts: [], uiBase: '/ui'});
  await backend.loadPackage('Common');
  await backend.loadPackage('Main');
  const view = backend.create('Main', 'MainView');
  backend.root.addChild(view);
  Object.assign(window, {view, ready: true});
})().catch(e => { (window as unknown as {failure: unknown}).failure = String(e); });`);
    await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', keepNames: true});
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="/app.js"></script>');
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 10000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      const info = await page.evaluate(() => {
        const styles = [...document.querySelectorAll('style')].map(s => s.textContent ?? '').join('\n');
        const titleSpan = window.view.native.getChild('title').element._span;
        const inputEl = window.view.native.getChild('nick').element.querySelector('input, textarea');
        return {
          hasUndefinedFont: styles.includes('font-family : undefined') || styles.includes('font-family: undefined'),
          loadedFontFaces: [...document.fonts].length,
          titleFamily: getComputedStyle(titleSpan).fontFamily,
          inputFamily: inputEl ? getComputedStyle(inputEl).fontFamily : null
        };
      });
      await page.close();
      assert.equal(info.hasUndefinedFont, false, '舞台样式表不应拼出 font-family: undefined');
      assert.equal(info.loadedFontFaces, 0, '不加载任何项目字体文件');
      assert.match(info.titleFamily, /system-ui|sans-serif/i);
      assert.equal(info.inputFamily, info.titleFamily, '输入框与普通文字使用同一套无衬线系统字体栈');
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
    fs.rmSync(parent, {recursive: true, force: true});
  }
});
