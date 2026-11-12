// lgui build 端到端测试：输出目录安全校验（LGUI-CLI-150）、纯代码工程只含 html/js/css/json、LGUI 运行时体积统计、子路径静态打开与换语言、带资源工程兼容。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from '../unit/cli/helpers.mjs';
import {launchBrowser, serve} from '../helpers/browser.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else out.push({rel, ext: path.extname(entry.name).toLowerCase(), size: fs.statSync(full).size});
  }
  return out;
}

test('lgui build：拒绝额外位置参数（LGUI-CLI-006）和不安全的 --out 目录（LGUI-CLI-150），不破坏源码', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-build-safe-'));
  assert.equal((await run(['init', 'game', '--code-only'], parent)).code, 0);
  const root = path.join(parent, 'game');

  const extra = JSON.parse((await run(['build', 'extra', '--json'], root)).stdout);
  assert.equal(extra.ok, false);
  assert.equal(extra.errors[0].code, 'LGUI-CLI-006');

  fs.writeFileSync(path.join(root, 'plain.txt'), 'keep');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-build-ext-'));
  fs.symlinkSync(outside, path.join(root, 'sym-out'), 'dir');

  for (const badOut of ['', '.', '..', 'src', 'src/sub', 'ui', 'i18n', 'tests', '.lgui', '.lgui/framework', 'plain.txt', 'sym-out', 'sym-out/nested']) {
    const res = JSON.parse((await run(['build', '--out', badOut, '--json'], root)).stdout);
    assert.equal(res.ok, false, `--out=${badOut}`);
    assert.equal(res.errors[0].code, 'LGUI-CLI-150', `--out=${badOut}: ${JSON.stringify(res.errors)}`);
  }
  assert.ok(fs.existsSync(path.join(root, 'src/main.ts')));
  assert.equal(fs.readFileSync(path.join(root, 'plain.txt'), 'utf8'), 'keep');
});

test('lgui build：纯代码工程（无图、无 mp3、无字体、带代码图标 + synth 声音 + host 画布）构建产物只含 html/js/css/json，打印 LGUI 运行时字节数，子路径打开与切换语言正常', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-build-codeonly-'));
  assert.equal((await run(['init', 'cube', '--code-only'], parent)).code, 0);
  const root = path.join(parent, 'cube');

  fs.writeFileSync(path.join(root, 'src/icons.ts'), `import type {IconDef} from 'lgui';
export const icons: Record<string, IconDef> = {
  spark: {
    width: 32,
    height: 32,
    shapes: [{type: 'circle', cx: 16, cy: 16, r: 12, fill: '#5de2c6'}]
  }
};
`);

  const commonBtn = path.join(root, 'ui/assets/Common/Button.xml');
  fs.writeFileSync(commonBtn, fs.readFileSync(commonBtn, 'utf8').replace(
    '</displayList>',
    '    <loader id="n2" name="icon" xy="16,20" size="32,32" align="center" vAlign="middle" fill="scale"/>\n  </displayList>'
  ));

  for (const xmlRel of ['ui/assets/Main/MainView.xml', 'ui/assets/Main/MainView@portrait.xml']) {
    const full = path.join(root, xmlRel);
    const updated = fs.readFileSync(full, 'utf8')
      .replace(/<component size="/, '<component opaque="false" size="')
      .replace(/<graph id="n0" name="bg"[\s\S]*?<\/graph>\s*/, '')
      .replace('<Button title="点我"/>', '<Button title="点我" icon="icon://spark" sound="synth://ping"/>');
    fs.writeFileSync(full, updated);
  }

  fs.writeFileSync(path.join(root, 'src/modules/main/MainModel.ts'), `import {lgui} from 'lgui';
export const mainModel = lgui.Model({clicks: 0}, set => ({
  addClick(next: number) { set({clicks: next}); }
}));
`);
  fs.writeFileSync(path.join(root, 'src/modules/main/MainController.ts'), `import {Controller, lgui} from 'lgui';
import {mainModel} from './MainModel';

class MainController extends Controller {
  click(): void {
    const next = mainModel.get().clicks + 1;
    mainModel.addClick(next);
    void lgui.setLanguage(next % 2 === 1 ? 'en' : 'zh-CN');
  }
}
export const mainController = new MainController();
`);
  fs.writeFileSync(path.join(root, 'src/modules/main/MainView.ts'), `import {View, pick, lgui} from 'lgui';
import type {Bind, Keys} from 'lgui';
import type {MainViewUI} from 'lgui/ui';
import {mainModel} from './MainModel';
import {mainController} from './MainController';

export class MainView extends View<MainViewUI> {
  static component = 'Main/MainView';
  static layer = 'hud' as const;
  static fullScreen = true;
  static music = 'synth://bgm';

  bind: Bind<MainViewUI> = {
    status: {text: pick(mainModel, s => s.clicks, n => (n === 0 ? lgui.t('main.hint') : lgui.t('main.clicked', {count: n})))},
    button: {click: () => mainController.click()}
  };
  keys: Keys = {back: 'none'};
}
`);
  fs.writeFileSync(path.join(root, 'src/main.ts'), `import {lgui} from 'lgui';
import {icons} from './icons';
import {MainView} from './modules/main/MainView';

export default lgui.app({
  backend: 'h5',
  icons,
  async start() {
    await lgui.ui.open(MainView);
  }
});
`);
  fs.mkdirSync(path.join(root, 'host'), {recursive: true});
  fs.writeFileSync(path.join(root, 'host/main.ts'), `import {defineWebHost} from 'lgui/host';

const played: string[] = [];
(window as unknown as {__hostPlayed: string[]}).__hostPlayed = played;

export default defineWebHost({
  audio: {
    play(url) { played.push('sfx:' + url); },
    music(url) { if (url) played.push('bgm:' + url); },
    setPaused() {}
  },
  mount(stage) {
    const ctx = stage.canvas.getContext('2d');
    const paint = () => {
      const {width, height, pixelRatio} = stage.size();
      stage.canvas.width = Math.max(1, Math.round(width * pixelRatio));
      stage.canvas.height = Math.max(1, Math.round(height * pixelRatio));
      if (ctx) {
        ctx.fillStyle = '#143352';
        ctx.fillRect(0, 0, stage.canvas.width, stage.canvas.height);
      }
    };
    paint();
    return stage.onResize(paint);
  }
});
`);

  const checkRes = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.equal(checkRes.ok, true, JSON.stringify(checkRes.errors));

  const human = await run(['build'], root);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /已构建网页包 → dist\//);
  assert.match(human.stdout, /其中 LGUI 运行时：[\d,]+ 字节/);

  const jsonRes = JSON.parse((await run(['build', '--json'], root)).stdout);
  assert.equal(jsonRes.ok, true, JSON.stringify(jsonRes.errors));
  const data = jsonRes.data;
  const distDir = path.join(root, 'dist');
  const diskFiles = walk(distDir);
  const allowedExts = new Set(['.html', '.js', '.css', '.json']);
  for (const f of diskFiles) {
    assert.ok(allowedExts.has(f.ext), `dist/ 里不应出现其它扩展名：${f.rel}`);
  }
  assert.equal(data.totalBytes, diskFiles.reduce((sum, f) => sum + f.size, 0));
  assert.deepEqual(data.assets, {images: 0, sounds: 0, fonts: 0});
  assert.ok(data.lguiRuntimeBytes > 20_000, `lguiRuntimeBytes=${data.lguiRuntimeBytes}`);
  assert.ok(data.lguiRuntimeBytes <= data.appJsBytes);
  assert.equal(data.lguiFrameworkBytes + data.fairyguiDomBytes >= data.lguiRuntimeBytes, true);

  const unmin = JSON.parse((await run(['build', '--no-minify', '--out', 'build/unmin', '--json'], root)).stdout);
  assert.equal(unmin.ok, true, JSON.stringify(unmin.errors));
  assert.equal(unmin.data.minify, false);
  assert.ok(unmin.data.appJsBytes > data.appJsBytes, '未压缩包应比默认压缩包更大');

  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const server = await serve({'/sub/game': distDir});
  try {
    const page = await browser.newPage({viewport: {width: 960, height: 540}, locale: 'zh-CN'});
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(server.url + '/sub/game/index.html');
    await page.waitForFunction(() => window.__lguiReady === true);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.deepEqual(pageErrors, []);

    const initial = await page.evaluate(() => {
      const loaderEl = [...document.querySelectorAll('fgui-stage fgui-movieclip')].find(el => getComputedStyle(el).backgroundImage.includes('data:image/svg+xml'));
      const canvas = document.querySelector('canvas.lgui-canvas');
      const pixel = canvas?.getContext('2d')?.getImageData(10, 10, 1, 1).data;
      return {
        title: document.title,
        hasDevGlobal: '__lgui' in window,
        iconLoaded: Boolean(loaderEl && loaderEl.getBoundingClientRect().width > 0),
        canvasBlue: pixel ? [pixel[0], pixel[1], pixel[2]] : null,
        texts: [...document.querySelectorAll('fgui-stage span.fgui-text')].map(el => el.textContent),
        played: window.__hostPlayed
      };
    });
    assert.equal(initial.title, 'cube');
    assert.equal(initial.hasDevGlobal, false, '正式构建不应暴露开发用 window.__lgui');
    assert.equal(initial.iconLoaded, true);
    assert.deepEqual(initial.canvasBlue, [0x14, 0x33, 0x52]);
    assert.ok(initial.texts.includes('点我'), JSON.stringify(initial.texts));
    assert.ok(initial.played.includes('bgm:synth://bgm'), JSON.stringify(initial.played));

    // 点击按钮：触发 synth://ping 音效并切换到英文（加载 ./i18n/en.json 重建组件）。
    const btnRect = await page.evaluate(() => {
      const span = [...document.querySelectorAll('fgui-stage span.fgui-text')].find(el => el.textContent === '点我');
      const r = span.getBoundingClientRect();
      return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    });
    await page.mouse.click(btnRect.x, btnRect.y);
    await page.waitForFunction(() => [...document.querySelectorAll('fgui-stage span.fgui-text')].some(el => el.textContent === 'Tap me'));
    const afterTap = await page.evaluate(() => ({
      texts: [...document.querySelectorAll('fgui-stage span.fgui-text')].map(el => el.textContent),
      played: window.__hostPlayed
    }));
    assert.ok(afterTap.texts.includes('Tap me'), JSON.stringify(afterTap.texts));
    assert.ok(afterTap.texts.includes('Hello, LGUI'), JSON.stringify(afterTap.texts));
    assert.ok(afterTap.texts.some(s => /Clicked 1/.test(s)), JSON.stringify(afterTap.texts));
    assert.ok(afterTap.played.includes('sfx:synth://ping'), JSON.stringify(afterTap.played));
    assert.deepEqual(pageErrors, []);
  } finally {
    await server.close();
    await browser.close();
  }
});

test('lgui build：带图片与 mp3 的常规工程（背包示例）照常出包并在浏览器打开', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-build-inv-'));
  const root = path.join(temp, 'inventory');
  fs.cpSync(path.join(repo, 'examples/inventory'), root, {recursive: true});
  // examples/inventory 不带 .lgui/framework 副本，lgui build 会自动补齐框架副本。
  const res = JSON.parse((await run(['build', '--json'], root)).stdout);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.data.assets.images, 41);
  assert.ok(res.data.assets.sounds > 0);
  assert.ok(!res.data.extensions.includes('.xml'), '常规工程网页包同样不含 .xml 文件');

  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const server = await serve({'/': path.join(root, 'dist')});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(server.url + '/index.html');
    await page.waitForFunction(() => window.__lguiReady === true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await server.close();
    await browser.close();
  }
});
