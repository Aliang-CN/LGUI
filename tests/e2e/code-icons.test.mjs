// 代码图标浏览器端到端测试：界面包不含任何图片或 .svg 文件，shapes（SVG）和 draw（Canvas 2D）代码图标在加载器、按钮、标签中真实画出像素。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWeb} from '../../plugin/tools/lib/generate/index.mjs';
import {esbuild, sharp} from '../../plugin/tools/lib/vendor.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const h5 = path.join(repo, 'plugin/framework/backends/h5');
const core = path.join(repo, 'plugin/framework/core');
const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;

async function buildIconSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-e2e-icons-'));
  const pkg = path.join(root, 'ui/assets/Hud');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="hudicons" type="Layabox" version="3.0"/>'));
  fs.writeFileSync(path.join(pkg, 'package.xml'), xml(`<packageDescription id="hud00001"><resources>
    <component id="main0001" name="Main.xml" path="/" exported="true"/>
    <component id="btn00001" name="IconBtn.xml" path="/" exported="true"/>
    <component id="lbl00001" name="IconLbl.xml" path="/" exported="true"/>
  </resources></packageDescription>`));
  fs.writeFileSync(path.join(pkg, 'IconBtn.xml'), xml(`<component size="140,64" extention="Button">
    <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
    <displayList>
      <loader id="n0" name="icon" xy="8,8" size="48,48" align="center" vAlign="middle" fill="scale"/>
      <text id="n1" name="title" xy="64,8" size="68,48" fontSize="24" color="#ffffff" autoSize="shrink" singleLine="true" text="播"/>
    </displayList>
    <Button mode="Check"/>
  </component>`));
  fs.writeFileSync(path.join(pkg, 'IconLbl.xml'), xml(`<component size="160,64" extention="Label"><displayList>
    <loader id="n0" name="icon" xy="8,8" size="48,48" align="center" vAlign="middle" fill="scale"/>
    <text id="n1" name="title" xy="64,8" size="88,48" fontSize="24" color="#ffffff" autoSize="shrink" singleLine="true" text="星"/>
  </displayList><Label/></component>`));
  fs.writeFileSync(path.join(pkg, 'Main.xml'), xml(`<component size="480,320"><displayList>
    <loader id="n0" name="vec" xy="20,20" size="64,64" url="icon://play" fill="scale"/>
    <loader id="n1" name="proc" xy="100,20" size="64,64" url="icon://spark" fill="scale"/>
    <loader id="n2" name="half" xy="180,20" size="64,64" url="icon://play" fill="scale" fillMethod="hz" fillOrigin="0" fillAmount="50"/>
    <component id="n3" name="btn" src="btn00001" xy="20,110" size="140,64">
      <Button title="播" icon="icon://play" selectedIcon="icon://spark"/>
    </component>
    <component id="n4" name="lbl" src="lbl00001" xy="180,110" size="160,64">
      <Label title="星" icon="icon://spark"/>
    </component>
  </displayList></component>`));

  const out = path.join(root, 'web/ui');
  await generateWeb(path.join(root, 'ui/UI.fairy'), out);
  // 确认生成目录里没有任何 .png 或 .svg 文件。
  const generatedFiles = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else generatedFiles.push(entry.name);
    }
  };
  walk(out);
  assert.equal(generatedFiles.some(n => /\.(png|jpg|svg)$/i.test(n)), false, `意外生成了图片文件：${generatedFiles.join(', ')}`);

  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `
    import * as fgui from ${JSON.stringify(path.join(h5, 'vendor/fairygui.module.js'))};
    import {installFairyGuiPatches} from ${JSON.stringify(path.join(h5, 'fairygui-patches/index.ts'))};
    import {registerIcons, setIconFaultReporter} from ${JSON.stringify(path.join(core, 'index.ts'))};

    const faults: string[] = [];
    setIconFaultReporter(err => faults.push(err.code + ':' + err.message));
    registerIcons({
      play: {
        viewBox: [0, 0, 64, 64],
        shapes: [
          {type: 'rect', x: 4, y: 4, width: 56, height: 56, rx: 12, fill: '#e63946'},
          {type: 'polygon', points: [[24, 18], [24, 46], [48, 32]], fill: '#ffffff'}
        ]
      },
      spark: {
        width: 64,
        height: 64,
        draw(g, w, h) {
          const grad = g.createLinearGradient(0, 0, w, h);
          grad.addColorStop(0, '#06d6a0');
          grad.addColorStop(1, '#118ab2');
          g.fillStyle = grad;
          g.fillRect(4, 4, w - 8, h - 8);
        }
      }
    });

    (async () => {
      installFairyGuiPatches();
      await fgui.UIPackage.loadImageManifest('/ui/manifest.json');
      await fgui.UIPackage.loadPackage('/ui/Hud');
      const view = fgui.UIPackage.createObject('Hud', 'Main').asCom;
      fgui.GRoot.inst.addChild(view);
      Object.assign(window, {fgui, view, faults, ready: true});
    })().catch(error => { (window as unknown as {failure: string}).failure = String(error); });
  `);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#000}</style><body><script type="module" src="/app.js"></script>');
  return path.join(root, 'web');
}

test('浏览器端代码图标：无图片包渲染 shapes（SVG）与 draw（Canvas 2D）、Check 按钮切换、fill 裁剪与未注册报错', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const web = await buildIconSite();
  const server = await serve({'/': web});
  try {
    const page = await browser.newPage({viewport: {width: 480, height: 320}});
    await page.goto(server.url + '/index.html');
    await page.waitForFunction(() => window.ready || window.failure);
    assert.equal(await page.evaluate(() => window.failure ?? null), null);
    // 等 Image.refresh() 的 requestAnimationFrame 把 backgroundImage 设好，并确保两张 data URL 都解码完成再截图。
    await page.evaluate(async () => {
      await new Promise(r => requestAnimationFrame(r));
      for (const name of ['vec', 'proc']) {
        const img = new Image();
        img.src = window.view.getChild(name)._content.src;
        await img.decode();
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });

    const png = await page.screenshot();
    const {data, info} = await sharp()(png).raw().toBuffer({resolveWithObject: true});
    const pixelAt = (x, y) => {
      const idx = (y * info.width + x) * info.channels;
      return {r: data[idx], g: data[idx + 1], b: data[idx + 2]};
    };
    // vec 在 (20,20) 尺寸 64×64，(32,32) 落在红色圆角底框 (#e63946 = 230, 57, 70) 上；
    // proc 在 (100,20) 尺寸 64×64，(132,52) 落在青绿渐变上。
    const vecPx = pixelAt(32, 32);
    const procPx = pixelAt(132, 52);
    assert.ok(vecPx.r > 200 && vecPx.g < 90, `shapes 矢量图标未在屏幕上画出红色像素：${JSON.stringify(vecPx)}`);
    assert.ok(procPx.g > 140 && procPx.r < 80, `draw 过程式图标未在屏幕上画出青绿像素：${JSON.stringify(procPx)}`);

    const report = await page.evaluate(() => {
      const vec = window.view.getChild('vec');
      const proc = window.view.getChild('proc');
      const halfClip = getComputedStyle(window.view.getChild('half')._content).clipPath;
      const btn = window.view.getChild('btn');
      const lbl = window.view.getChild('lbl');
      const vecSrc = vec._content.src.slice(0, 32);
      const procSrc = proc._content.src.slice(0, 24);
      const btnBefore = btn.getChild('icon').url;
      btn.selected = true;
      const btnAfter = btn.getChild('icon').url;
      const lblUrl = lbl.getChild('icon').url;
      vec.url = 'icon://unregistered';
      return {
        vecSrc, procSrc,
        vecSize: [vec.sourceWidth, vec.sourceHeight],
        procSize: [proc.sourceWidth, proc.sourceHeight],
        halfClip, btnBefore, btnAfter, lblUrl,
        faults: window.faults
      };
    });

    assert.equal(report.vecSrc, 'data:image/svg+xml;charset=utf-8');
    assert.equal(report.procSrc, 'data:image/png;base64,iV');
    assert.deepEqual(report.vecSize, [64, 64]);
    assert.deepEqual(report.procSize, [64, 64]);
    assert.equal(report.halfClip, 'inset(0px 50% 0px 0px)');
    assert.equal(report.btnBefore, 'icon://play');
    assert.equal(report.btnAfter, 'icon://spark');
    assert.equal(report.lblUrl, 'icon://spark');
    assert.equal(report.faults.length, 1);
    assert.match(report.faults[0], /^LGUI-RT-072:/);
  } finally {
    await server.close();
    await browser.close();
  }
});
