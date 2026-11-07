// lgui dev 和 lgui verify 各用各的生成目录（.lgui/build/dev/、.lgui/build/verify/），dev 开着时跑 verify 不动 dev 的文件；
// lgui verify --view 能用 --params 传参数，打开出错带着原来的错误码报 LGUI-CLI-115（不是 LGUI-CLI-999）；
// lgui dev 监视工程配置 devWatch 里的路径，改了就推送刷新，路径不存在报 LGUI-CLI-116。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {run} from '../unit/cli/helpers.mjs';
import {launchBrowser} from '../helpers/browser.mjs';
import {startDev} from '../../plugin/tools/lib/dev/index.mjs';
import {readProject} from '../../plugin/tools/lib/project.mjs';

async function project() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-dirs-'));
  await run(['init', 'game'], parent);
  return path.join(parent, 'game');
}
const get = url => new Promise((resolve, reject) => http.get(url, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({status: res.statusCode, body})); }).on('error', reject));

// 一个要参数的界面：没有 id 就在 onOpen 里报错
const PARAM_VIEW = `import { View } from 'lgui';
import type { Bind } from 'lgui';
import type { MainViewUI } from 'lgui/ui';

export class ParamView extends View<MainViewUI> {
  static component = 'Main/MainView';
  static layer = 'popup' as const;
  static params: { id?: number } = {};
  bind: Bind<MainViewUI> = {};
  onOpen(params: { id?: number }) { if (params.id === undefined) throw new Error('ParamView 要 id'); }
}
`;

test('lgui dev 开着时跑 lgui verify：各用各的目录，verify 不删 dev 的文件；--view 用 --params 传参数，没传时报 LGUI-CLI-115', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  await browser.close();
  const root = await project();
  fs.writeFileSync(path.join(root, 'src/modules/main/ParamView.ts'), PARAM_VIEW);
  const server = await startDev(root, readProject(root), {port: 0});
  try {
    assert.deepEqual(server.errors(), []);
    assert.ok(fs.existsSync(path.join(root, '.lgui/build/dev/app.js')) && fs.existsSync(path.join(root, '.lgui/build/dev/ui/manifest.json')));
    const before = fs.readFileSync(path.join(root, '.lgui/build/dev/app.js'));

    const missing = JSON.parse((await run(['verify', '--size', 'desktop', '--view', 'ParamView', '--json'], root)).stdout);
    assert.deepEqual(missing.errors.map(e => e.code), ['LGUI-CLI-115'], JSON.stringify(missing.errors));
    assert.match(missing.errors[0].message, /打开 ParamView 时出错：.*ParamView 要 id/);
    assert.match(missing.errors[0].fix, /--params/);

    const ok = JSON.parse((await run(['verify', '--size', 'desktop', '--view', 'ParamView', '--params', '{"id":1}', '--json'], root)).stdout);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.deepEqual(ok.data.shots.map(s => s.image), ['.lgui/build/verify/desktop-landscape.png', '.lgui/build/verify/desktop-portrait.png']);
    const snap = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/verify/desktop-landscape.json'), 'utf8'));
    assert.deepEqual(snap.layers.popup, ['ParamView']);
    assert.ok(fs.existsSync(path.join(root, '.lgui/build/verify/site/app.js')));
    assert.ok(!fs.existsSync(path.join(root, '.lgui/build/web')), '不再写共用的 .lgui/build/web/');

    // dev 的文件还在、没被 verify 换掉，页面照常能取到
    assert.ok(fs.readFileSync(path.join(root, '.lgui/build/dev/app.js')).equals(before));
    assert.equal((await get(`${server.url}ui/manifest.json`)).status, 200);
    assert.equal((await get(`${server.url}app.js`)).status, 200);
  } finally {
    await server.close();
  }

  for (const [argv, pattern] of [
    [['--params', '{"id":1}'], /要和 --view 一起用/],
    [['--view', 'ParamView', '--params', '{id:1}'], /不是合法的 JSON/],
    [['--view', 'ParamView', '--params', '[1]'], /要是一个 JSON 对象/]
  ]) {
    const bad = JSON.parse((await run(['verify', '--size', 'desktop', ...argv, '--json'], root)).stdout);
    assert.equal(bad.errors[0].code, 'LGUI-CLI-114', JSON.stringify(bad.errors));
    assert.match(bad.errors[0].message, pattern);
  }
});

test('lgui dev：devWatch 写成工程根目录或它的上级时不监视 .lgui/build/（打包写盘不会再触发打包）；根目录下别的文件改了照样刷新', async () => {
  for (const watch of ['.', '..']) {
    const root = await project();
    const file = path.join(root, '.lgui/project.json');
    fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), devWatch: [watch]}, null, 2));
    const server = await startDev(root, readProject(root), {port: 0});
    let req, reloads = 0;
    try {
      await new Promise((resolve, reject) => {
        req = http.get(`${server.url}__lgui/events`, res => {
          res.setEncoding('utf8');
          res.on('data', chunk => {
            if (chunk.startsWith(': lgui')) resolve();
            reloads += (chunk.match(/event: reload/g) ?? []).length;
          });
        });
        req.on('error', reject);
      });
      fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
      for (let waited = 0; reloads === 0 && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(reloads >= 1, `devWatch ${watch}：改了工程根目录下的 notes.txt 以后 5 秒内没有推送刷新`);
      const after = reloads;
      await new Promise(resolve => setTimeout(resolve, 2000));
      assert.equal(reloads, after, `devWatch ${watch}：没有再改文件，2 秒里又推送了 ${reloads - after} 次刷新（打包写进 .lgui/build/ 又触发了打包）`);
    } finally {
      req?.destroy();
      await server.close();
    }
  }
});

test('lgui dev：devWatch 里的目录改了就推送刷新；路径不存在报 LGUI-CLI-116', async () => {
  const root = await project();
  const config = path.join(path.dirname(root), 'Config');
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, 'items.json'), '{"a":1}\n');
  const file = path.join(root, '.lgui/project.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({...raw, devWatch: ['../Nope']}, null, 2));
  await assert.rejects(startDev(root, readProject(root), {port: 0}), e => e.errors?.[0]?.code === 'LGUI-CLI-116' && /\.\.\/Nope/.test(e.errors[0].message));

  fs.writeFileSync(file, JSON.stringify({...raw, devWatch: ['../Config']}, null, 2));
  const server = await startDev(root, readProject(root), {port: 0});
  let req;
  try {
    const reloaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('改了 ../Config 以后 5 秒内没有推送刷新')), 5000);
      req = http.get(`${server.url}__lgui/events`, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (chunk.startsWith(': lgui')) fs.writeFileSync(path.join(config, 'items.json'), '{"a":2}\n'); // 连上以后再改
          if (chunk.includes('event: reload')) { clearTimeout(timer); resolve(); }
        });
      });
      req.on('error', reject);
    });
    await reloaded;
  } finally {
    req?.destroy();
    await server.close();
  }
});
