// FairyGUI-dom 补丁的端到端测试（plugin/framework/backends/h5/vendor/PATCHES.md）：生成的 fairygui.module.js 加 fairygui-patches/ 的钩子。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWeb} from '../../plugin/tools/lib/generate/index.mjs';
import {sharp, esbuild} from '../../plugin/tools/lib/vendor.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const h5 = path.join(repo, 'plugin/framework/backends/h5');
const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-dom-'));
  const pkg = path.join(root, 'ui/assets/Test');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="domtest" type="Layabox" version="3.0"/>'));
  await sharp()({create: {width: 32, height: 32, channels: 4, background: {r: 0, g: 200, b: 0, alpha: 1}}}).png().toFile(path.join(pkg, 'green.png'));
  await sharp()({create: {width: 16, height: 16, channels: 4, background: {r: 0, g: 0, b: 200, alpha: 1}}}).png().toFile(path.join(pkg, 'blue.png'));
  fs.writeFileSync(path.join(pkg, 'package.xml'), xml(`<packageDescription id="test0001"><resources>
    <component id="main0001" name="Main.xml" path="/" exported="true"/>
    <image id="green001" name="green.png" path="/" exported="true"/>
    <image id="blue0001" name="blue.png" path="/" exported="true"/>
  </resources></packageDescription>`));
  fs.writeFileSync(path.join(pkg, 'Main.xml'), xml(`<component size="400,300"><displayList>
    <image id="n0" name="bar" src="green001" xy="0,0" size="200,20" fillMethod="hz" fillOrigin="0" fillAmount="50"/>
    <image id="n1" name="ring" src="green001" xy="0,40" size="100,100"/>
    <image id="n2" name="blue" src="blue0001" xy="120,40" size="16,16"/>
    <text id="n3" name="shadowed" xy="0,160" size="300,40" fontSize="24" color="#112233" shadowColor="#ff0000" shadowOffset="2,3" autoSize="shrink" text="阴影"/>
    <text id="n4" name="red" xy="0,210" size="300,40" fontSize="24" color="#ff0000" autoSize="shrink" text="红字"/>
  </displayList></component>`));
  const out = path.join(root, 'web/ui');
  await generateWeb(path.join(root, 'ui/UI.fairy'), out);
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `import * as fgui from ${JSON.stringify(path.join(h5, 'vendor/fairygui.module.js'))};
    import {installFairyGuiPatches} from ${JSON.stringify(path.join(h5, 'fairygui-patches/index.ts'))};
    (async () => {
      installFairyGuiPatches();
      await fgui.UIPackage.loadImageManifest('/ui/manifest.json');
      const pkg = await fgui.UIPackage.loadPackage('/ui/Test');
      const view = fgui.UIPackage.createObject('Test', 'Main');
      fgui.GRoot.inst.addChild(view);
      Object.assign(window, {fgui, view, pkg, ready: true});
    })().catch(error => { (window as any).failure = String(error); });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="/app.js"></script>');
  return path.join(root, 'web');
}

test('FairyGUI-dom 补丁：fill、散图映射、文字阴影、文字颜色', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const web = await fixture();
  const server = await serve({'/': web});
  try {
    const page = await browser.newPage();
    await page.goto(server.url + '/index.html');
    await page.waitForFunction(() => window.ready || window.failure);
    assert.equal(await page.evaluate(() => window.failure ?? null), null);

    // 补丁 1：fill。XML 里写的水平 50%，再用代码改成 0% 和 100%；径向 360 用 mask。
    const clip = amount => page.evaluate(a => { const bar = window.view.getChild('bar'); if (a !== null) bar.fillAmount = a; return getComputedStyle(bar.element).clipPath; }, amount);
    assert.equal(await clip(null), 'inset(0px 50% 0px 0px)');
    assert.equal(await clip(0), 'inset(0px 100% 0px 0px)');
    assert.equal(await clip(1), 'inset(0px 0% 0px 0px)');
    const radial = await page.evaluate(() => {
      const ring = window.view.getChild('ring');
      ring.fillMethod = window.fgui.FillMethod.Radial360; ring.fillOrigin = 0; ring.fillAmount = 0.25;
      const top = ring.element.style.maskImage;
      ring.fillOrigin = 1;
      const bottom = ring.element.style.maskImage;
      ring.fillClockwise = false;
      return {top, bottom, ccw: ring.element.style.maskImage, computed: getComputedStyle(ring.element).maskImage};
    });
    assert.equal(radial.top, 'conic-gradient(rgb(0, 0, 0) 0deg, rgb(0, 0, 0) 90deg, transparent 90deg, transparent 360deg)');
    assert.equal(radial.bottom, 'conic-gradient(from 180deg, rgb(0, 0, 0) 0deg, rgb(0, 0, 0) 90deg, transparent 90deg, transparent 360deg)');
    assert.equal(radial.ccw, 'conic-gradient(from 180deg, transparent 0deg, transparent 270deg, rgb(0, 0, 0) 270deg, rgb(0, 0, 0) 360deg, transparent 360deg, transparent 360deg)');
    assert.notEqual(radial.computed, 'none');
    const none = await page.evaluate(() => { const ring = window.view.getChild('ring'); ring.fillMethod = 0; const s = getComputedStyle(ring.element); return [s.clipPath, s.maskImage]; });
    assert.deepEqual(none, ['none', 'none']);

    // 补丁 2：散图都按映射加载。
    const images = await page.evaluate(async () => {
      const files = window.pkg._items.filter(item => item.type === window.fgui.PackageItemType.Image).map(item => item.file);
      return Promise.all(files.map(async file => ({file, ok: (await fetch(file)).ok})));
    });
    assert.deepEqual(images.map(i => i.file.replace(/^.*\/ui\//, '')).sort(), ['Test/blue0001.png', 'Test/green001.png']);
    assert.ok(images.every(i => i.ok));
    const blueSize = await page.evaluate(async () => { const img = new Image(); img.src = window.pkg.getItemById('blue0001').file; await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
    assert.deepEqual(blueSize, [16, 16]);

    // 补丁 4：文字阴影。
    const shadow = await page.evaluate(() => getComputedStyle(window.view.getChild('shadowed').element.querySelector('span.fgui-text')).textShadow);
    assert.equal(shadow, 'rgb(255, 0, 0) 2px 3px 0px');

    // 补丁 3：文字颜色——复现检查：包里写的 #ff0000，网页上算出来的颜色。
    const color = await page.evaluate(() => getComputedStyle(window.view.getChild('red').element.querySelector('span.fgui-text')).color);
    assert.equal(color, 'rgb(255, 0, 0)');
  } finally {
    await server.close();
    await browser.close();
  }
});

test('包不在散图映射里、包地址错误时明确报错', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const web = await fixture();
  const server = await serve({'/': web});
  try {
    const page = await browser.newPage();
    await page.goto(server.url + '/index.html');
    await page.waitForFunction(() => window.ready || window.failure);
    const errors = await page.evaluate(async () => {
      const out = [];
      try { await window.fgui.UIPackage.loadPackage('/ui/Nope'); } catch (e) { out.push(String(e.message)); }
      window.fgui.UIPackage.setImageManifest({schemaVersion: 1, packages: {}});
      window.fgui.UIPackage.removePackage('Test');
      try { await window.fgui.UIPackage.loadPackage('/ui/Test'); } catch (e) { out.push(String(e.message)); }
      try { window.fgui.UIPackage.setImageManifest({}); } catch (e) { out.push(String(e.message)); }
      return out;
    });
    assert.match(errors[0], /^LGUI-RT-011/);
    assert.match(errors[1], /^LGUI-RT-010 .*散图映射里没有包 Test/);
    assert.match(errors[2], /^LGUI-RT-010/);
  } finally {
    await server.close();
    await browser.close();
  }
});

test('补丁装不上（上游少了要挂的方法）：报 LGUI-RT-230；再调用报同一个错，前面装上的钩子不会被包第二层', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-dom-retry-'));
  fs.mkdirSync(path.join(root, 'web'));
  const entry = path.join(root, 'entry.ts');
  // 补丁 10 挂在 Transition.onOwnerAddedToStage 上，排在文字补丁（applyFormat）之后装
  fs.writeFileSync(entry, `import * as fgui from ${JSON.stringify(path.join(h5, 'vendor/fairygui.module.js'))};
    import {installFairyGuiPatches} from ${JSON.stringify(path.join(h5, 'fairygui-patches/index.ts'))};
    delete (fgui.Transition.prototype as any).onOwnerAddedToStage;
    const attempt = (): any => { try { installFairyGuiPatches(); return null; } catch (error) { return error; } };
    const first = attempt();
    const applyFormat = (fgui.TextField.prototype as any).applyFormat;
    const second = attempt();
    Object.assign(window, {result: {code: first?.code, message: first?.message, same: first === second, wrappedOnce: (fgui.TextField.prototype as any).applyFormat === applyFormat}, ready: true});`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="/app.js"></script>');
  const server = await serve({'/': path.join(root, 'web')});
  try {
    const page = await browser.newPage();
    await page.goto(server.url + '/index.html');
    await page.waitForFunction(() => window.ready);
    const result = await page.evaluate(() => window.result);
    assert.equal(result.code, 'LGUI-RT-230');
    assert.match(result.message, /补丁 10 装不上：上游没有 Transition\.onOwnerAddedToStage\(\) 了/);
    assert.equal(result.same, true, '再调用抛的是同一个错');
    assert.equal(result.wrappedOnce, true, '已经装上的 applyFormat 钩子没有再包一层');
  } finally {
    await server.close();
    await browser.close();
  }
});
