// FairyGUI-dom 补丁的帧耗时对比（开发用）：手机配置（375×812、DPR 3、CPU 降速 4 倍）下跑几百个 shrink 文字或九宫格，
// 比较装钩子前后（九宫格比较补丁 12 装 / 不装，以及逐个 will-change 作对照）每帧的时间。结果写进 PR，不进测试（数值跟机器有关）。
//
// 用法：node scripts/fairygui-dom/bench.mjs [--count 300] [--frames 120] [--throttle 4]
// 每个场景先预热 20 帧，再连续跑 frames 帧：记 requestAnimationFrame 的间隔（中位数、p95），以及 Chrome 的
// Performance.getMetrics 在这段时间里累计的 ScriptDuration / LayoutDuration / RecalcStyleDuration（折成每帧毫秒）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWeb} from '../../plugin/tools/lib/generate/index.mjs';
import {sharp, esbuild} from '../../plugin/tools/lib/vendor.mjs';
import {serve, launchBrowser} from '../../tests/helpers/browser.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const h5 = path.join(repo, 'plugin/framework/backends/h5');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const COUNT = arg('count', 300), FRAMES = arg('frames', 120), THROTTLE = arg('throttle', 4);
const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;

async function build() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-bench-'));
  const pkg = path.join(root, 'ui/assets/Bench');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="bench" type="Layabox" version="3.0"/>'));
  // 九宫格素材：外框深色、里面浅色，四角圆一点（带透明），像常见的面板
  const size = 96, r = 18;
  const raw = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4;
    const dx = Math.max(r - x, x - (size - 1 - r), 0), dy = Math.max(r - y, y - (size - 1 - r), 0);
    const inside = Math.hypot(dx, dy) <= r;
    const frame = x < 8 || y < 8 || x >= size - 8 || y >= size - 8;
    raw.set(inside ? (frame ? [30, 60, 90, 255] : [120, 200, 220, 255]) : [0, 0, 0, 0], k);
  }
  await sharp()(raw, {raw: {width: size, height: size, channels: 4}}).png().toFile(path.join(pkg, 'panel.png'));
  fs.writeFileSync(path.join(pkg, 'package.xml'), xml(`<packageDescription id="bench001"><resources>
    <component id="texts001" name="Texts.xml" path="/" exported="true"/>
    <component id="nines001" name="Nines.xml" path="/" exported="true"/>
    <image id="panel001" name="panel.png" path="/" exported="true" scale="9grid" scale9grid="30,30,36,36"/>
  </resources></packageDescription>`));
  const cols = 5, cell = [216, 60];
  const texts = Array.from({length: COUNT}, (_, i) => `<text id="t${i}" name="t${i}" xy="${(i % cols) * cell[0]},${Math.floor(i / cols) * cell[1]}" size="200,50" fontSize="32" color="#ffffff" strokeColor="#000000" strokeSize="2" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="按钮标题 ${i}"/>`);
  fs.writeFileSync(path.join(pkg, 'Texts.xml'), xml(`<component size="1080,${Math.ceil(COUNT / cols) * cell[1]}"><displayList>${texts.join('')}</displayList></component>`));
  const nines = Array.from({length: COUNT}, (_, i) => {
    const x = (i % cols) * 216 + 3, y = Math.floor(i / cols) * 130 + 2, w = 200 + (i * 7) % 11, h = 120 + (i * 5) % 9;
    return i % 2 ? `<loader id="n${i}" name="n${i}" xy="${x},${y}" size="${w},${h}" url="ui://bench001panel001" fill="scaleFree"/>` : `<image id="n${i}" name="n${i}" src="panel001" xy="${x},${y}" size="${w},${h}"/>`;
  });
  fs.writeFileSync(path.join(pkg, 'Nines.xml'), xml(`<component size="1080,${Math.ceil(COUNT / cols) * 130}"><displayList>${nines.join('')}</displayList></component>`));
  await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `import * as fgui from ${JSON.stringify(path.join(h5, 'vendor/fairygui.module.js'))};
    import {installFairyGuiPatches} from ${JSON.stringify(path.join(h5, 'fairygui-patches/index.ts'))};
    import {setNineSliceOverlap} from ${JSON.stringify(path.join(h5, 'fairygui-patches/nine-slice.ts'))};
    const q = new URLSearchParams(location.search);
    (async () => {
      const hooks = q.get('hooks') === '1';
      if (hooks) { installFairyGuiPatches(); await (fgui.UIPackage as any).loadImageManifest('/ui/manifest.json'); }
      const pkg = await fgui.UIPackage.loadPackage('/ui/Bench');
      if (!hooks) for (const item of (pkg as any)._items) if (item.type === 0) item.file = '/ui/Bench/' + item.id + '.png';
      const root = fgui.GRoot.inst;
      const scale = innerWidth / 1080;
      // 和 platform/index.ts 的 applyDesignSize 一样缩放根节点；九宫格的重叠宽度按缩放算（同 h5/index.ts）
      root.element.style.transformOrigin = '0 0'; root.element.style.transform = 'scale(' + scale + ')';
      setNineSliceOverlap(scale * devicePixelRatio);
      if (q.get('css')) { const s = document.createElement('style'); s.textContent = q.get('css') as string; document.head.appendChild(s); }
      let view = fgui.UIPackage.createObject('Bench', q.get('scene') as string) as any;
      root.addChild(view);
      const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // 关掉再打开这个界面：从创建到画完两帧（九宫格的 9 块在下一帧建好）用了多久
      (window as any).reopen = async () => {
        view.dispose();
        await frame2();
        const t0 = performance.now();
        view = fgui.UIPackage.createObject('Bench', q.get('scene') as string);
        root.addChild(view);
        await frame2();
        return performance.now() - t0;
      };
      const words = ['确定', '这是一段很长很长的按钮标题', 'Long English Title Here', '领取奖励'];
      let frame = 0;
      const step: Record<string, () => void> = {
        idle: () => {},
        // 每帧给全部文字换一次内容（长短交替，shrink 每次都要重新算）
        update: () => { frame++; for (let i = 0; i < view.numChildren; i++) view.getChildAt(i).text = words[(i + frame) % words.length] + ' ' + frame; },
        // 每帧把整个面板挪 1 像素（像列表滚动）
        move: () => { frame++; view.y = -(frame % 200); }
      };
      Object.assign(window, {
        run: (frames: number) => new Promise(resolve => {
          const times: number[] = []; let last = 0, n = 0, script = 0;
          const tick = (now: number) => {
            if (last) times.push(now - last);
            last = now;
            const t0 = performance.now(); step[q.get('step') as string](); script += performance.now() - t0;
            if (++n <= frames) requestAnimationFrame(tick); else resolve({times, script});
          };
          requestAnimationFrame(tick);
        }),
        ready: true
      });
    })().catch(e => { (window as any).failure = String(e); });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
  // 九宫格「修复前」：补丁 12 换成空的，其他钩子照装
  const stub = path.join(root, 'no-nine-slice.ts');
  fs.writeFileSync(stub, 'export const nineSliceFields = [] as const; export const nineSliceAssigned = [] as const; export function installNineSlice(): void {} export function setNineSliceOverlap(_: number): void {}');
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app-no12.js'), logLevel: 'silent', plugins: [{name: 'no-nine-slice', setup(b) { b.onResolve({filter: /nine-slice(\.ts)?$/}, () => ({path: stub})); }}]});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#334}</style><body><script type="module">import(new URLSearchParams(location.search).get("no12") ? "/app-no12.js" : "/app.js");</script>');
  return path.join(root, 'web');
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)]; };

async function measure(browser, url) {
  const context = await browser.newContext({viewport: {width: 375, height: 812}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: THROTTLE});
  await page.goto(url);
  await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 60000});
  const failure = await page.evaluate(() => window.failure ?? null);
  if (failure) throw new Error(failure);
  await page.evaluate(() => window.run(20));
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const m0 = await metrics();
  const {times, script} = await page.evaluate(n => window.run(n), FRAMES);
  const m1 = await metrics();
  const layers = (await cdp.send('LayerTree.enable').then(() => new Promise(resolve => { cdp.once('LayerTree.layerTreeDidChange', e => resolve(e.layers?.length ?? 0)); page.evaluate(() => { document.body.style.outline = '1px solid transparent'; }); setTimeout(() => resolve(-1), 3000); })));
  await context.close();
  const per = name => ((m1[name] - m0[name]) * 1000 / FRAMES).toFixed(2);
  return {frameMedian: median(times).toFixed(1), frameP95: p95(times).toFixed(1), stepScript: (script / FRAMES).toFixed(2), script: per('ScriptDuration'), layout: per('LayoutDuration'), style: per('RecalcStyleDuration'), layouts: ((m1.LayoutCount - m0.LayoutCount) / FRAMES).toFixed(1), layers};
}

async function measureOpen(browser, url) {
  const context = await browser.newContext({viewport: {width: 375, height: 812}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: THROTTLE});
  await page.goto(url);
  await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 60000});
  await page.evaluate(() => window.run(10));
  const times = [];
  for (let i = 0; i < 7; i++) times.push(await page.evaluate(() => window.reopen()));
  await context.close();
  return median(times).toFixed(1);
}

const web = await build();
const server = await serve({'/': web});
const browser = await launchBrowser();
if (!browser) throw new Error('没找到 Chrome 或 Edge。');
const cases = [
  ['shrink 文字 · 静止', 'Texts', 'idle', [['修复前（不装钩子）', 'hooks=0'], ['修复后', 'hooks=1']]],
  ['shrink 文字 · 每帧全部换字', 'Texts', 'update', [['修复前（不装钩子）', 'hooks=0'], ['修复后', 'hooks=1']]],
  ...['idle', 'move'].map(step => [step === 'idle' ? '九宫格 · 静止' : '九宫格 · 每帧整体移动', 'Nines', step, [
    ['修复前（一个元素的 border-image）', 'hooks=1&no12=1'],
    ['逐个 will-change（对照，没采用）', 'hooks=1&no12=1&css=' + encodeURIComponent('fgui-img,fgui-movieclip{will-change:transform}')],
    ['修复后（9 块、不透明处重叠）', 'hooks=1']
  ]])
];
console.log(`手机配置：375×812，DPR 3，CPU 降速 ${THROTTLE} 倍；每个场景 ${COUNT} 个控件、${FRAMES} 帧。每帧毫秒数。`);
console.log('| 场景 | 方案 | 帧间隔中位数 | 帧间隔 p95 | 脚本（Chrome 统计） | 布局 | 样式 | 每帧布局次数 | 合成层数 |');
console.log('|---|---|---|---|---|---|---|---|---|');
try {
  for (const [title, scene, step, variants] of cases) {
    for (const [label, query] of variants) {
      const r = await measure(browser, `${server.url}/index.html?scene=${scene}&step=${step}&${query}`);
      console.log(`| ${title} | ${label} | ${r.frameMedian} | ${r.frameP95} | ${r.script} | ${r.layout} | ${r.style} | ${r.layouts} | ${r.layers} |`);
    }
  }
  console.log('');
  console.log(`| 关掉再打开 ${COUNT} 个九宫格的界面（创建到画完两帧，毫秒，7 次中位数） | 修复前 | 修复后 |`);
  console.log('|---|---|---|');
  const base = await measureOpen(browser, `${server.url}/index.html?scene=Nines&step=idle&hooks=1&no12=1`);
  const fixed = await measureOpen(browser, `${server.url}/index.html?scene=Nines&step=idle&hooks=1`);
  console.log(`| 375×812@3，CPU 降速 ${THROTTLE} 倍 | ${base} | ${fixed} |`);
} finally {
  await browser.close();
  await server.close();
}
