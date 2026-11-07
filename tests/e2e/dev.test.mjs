// lgui dev：init → dev → 页面显示主界面；改 XML、改代码、改文本表都会自动刷新；语法错误时页面盖一层错误提示，改好后消失。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../unit/cli/helpers.mjs';
import {launchBrowser} from '../helpers/browser.mjs';
import {startDev} from '../../plugin/tools/lib/dev/index.mjs';
import {readProject} from '../../plugin/tools/lib/project.mjs';

const visibleText = page => page.evaluate(() => document.body.innerText);
const waitText = (page, text, timeout = 5000) => page.waitForFunction(t => document.body.innerText.includes(t), text, {timeout});

test('lgui dev：显示主界面，改 XML / 代码 / 文本表自动刷新，语法错误有提示', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-dev-'));
  const init = await run(['init', 'game'], parent);
  assert.equal(init.code, 0, init.stderr);
  const root = path.join(parent, 'game');
  const logs = [];
  const pushes = []; // dev 推送刷新的时刻（终端打印「已…，刷新页面。」）
  const server = await startDev(root, readProject(root), {port: 0, log: line => { logs.push(line); if (/^已.*，刷新页面。$/.test(line)) pushes.push(Date.now()); }});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}, locale: 'zh-CN'});
    await page.addInitScript(() => {
      const add = EventSource.prototype.addEventListener;
      EventSource.prototype.addEventListener = function(type, listener, options) {
        if (type !== 'reload' || typeof listener !== 'function') return add.call(this, type, listener, options);
        return add.call(this, type, event => {
          if (window.__delayNextReload) {
            window.__delayNextReload = false;
            setTimeout(() => listener.call(this, event), 600);
          } else listener.call(this, event);
        }, options);
      };
    });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__lguiReady, null, {timeout: 15000});
    await waitText(page, '你好，LGUI');
    await waitText(page, '点下面的按钮试试');
    assert.deepEqual(pageErrors, []);

    // 改 XML 里的标题文字，2 秒内页面更新（执行计划 S2-A8 的验收）。
    // 分两段等真实的条件（dev 推送刷新、页面显示新标题），各自最多等 5 秒，最后再比 2 秒：
    // 超了能看出是慢在 dev 重新生成界面、打包，还是页面重新加载；以前直接等 2 秒，超时只报一句等不到。
    const xml = path.join(root, 'ui/assets/Main/MainView.xml');
    const started = Date.now();
    fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace('text="你好，LGUI"', 'text="改过的标题"'));
    for (let waited = 0; !pushes.some(at => at >= started) && waited < 5000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
    const pushedAt = pushes.find(at => at >= started);
    assert.ok(pushedAt, `改了 MainView.xml 以后 5 秒内 dev 没有重新生成界面、推送刷新。终端输出：${logs.join(' | ')}`);
    await waitText(page, '改过的标题');
    const uiMs = Date.now() - started;
    assert.ok(uiMs <= 2000, `改 XML 到页面更新用了 ${uiMs} 毫秒，超过 2 秒：dev 重新生成界面、打包到推送刷新 ${pushedAt - started} 毫秒，推送以后页面重新加载到显示新标题 ${Date.now() - pushedAt} 毫秒`);

    // 改文本表
    const zh = path.join(root, 'i18n/zh-CN.json');
    fs.writeFileSync(zh, fs.readFileSync(zh, 'utf8').replace('点下面的按钮试试', '文本表改过了'));
    await waitText(page, '文本表改过了');

    // 改 src/ 里的代码
    const controller = path.join(root, 'src/modules/main/MainController.ts');
    const original = fs.readFileSync(controller, 'utf8');
    // A slow reload notification leaves the old document ready for longer than
    // 300ms. Waiting for a ready flag alone must not click its stale controller.
    await page.evaluate(() => { window.__delayNextReload = true; });
    const reloaded = page.waitForEvent('framenavigated', {predicate: frame => frame === page.mainFrame(), timeout: 5000});
    fs.writeFileSync(controller, original.replace('click() { mainModel.addClick(); }', 'click() { mainModel.addClick(); mainModel.addClick(); }'));
    await reloaded;
    await page.waitForFunction(() => window.__lguiReady, null, {timeout: 5000});
    const button = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(e => e.textContent === '点我' && e.children.length === 0);
      const r = el.getBoundingClientRect();
      return {x: r.x + r.width / 2, y: r.y + r.height / 2};
    });
    await page.mouse.click(button.x, button.y);
    await waitText(page, '点了 2 次');

    // 故意写一个语法错误：页面出现错误提示；改好后提示消失
    fs.writeFileSync(controller, original.replace('click() {', 'click() { const = ;'));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('lgui-overlay')).display === 'block', null, {timeout: 5000});
    const overlay = await page.evaluate(() => document.getElementById('lgui-overlay').textContent);
    assert.match(overlay, /LGUI-CLI-032/);
    assert.match(overlay, /MainController\.ts:\d+/);
    assert.ok(logs.some(l => /LGUI-CLI-032/.test(l)), '终端也打印错误码');
    fs.writeFileSync(controller, original);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('lgui-overlay')).display === 'none' && window.__lguiReady, null, {timeout: 5000});
    assert.ok((await visibleText(page)).includes('改过的标题'));
    console.log(`改 XML 到页面更新：${uiMs} 毫秒`);
  } finally {
    await server.close();
    await browser.close();
  }
});

test('端口被占用时报 LGUI-CLI-030；服务只监听 127.0.0.1', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-dev-port-'));
  await run(['init', 'game'], parent);
  const root = path.join(parent, 'game');
  const first = await startDev(root, readProject(root), {port: 0});
  try {
    assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const port = Number(new URL(first.url).port);
    await assert.rejects(startDev(root, readProject(root), {port}), e => e.code === 'LGUI-CLI-030' && /devPort|--port/.test(e.fix));
  } finally {
    await first.close();
  }
});
