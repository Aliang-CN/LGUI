import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from './cli/helpers.mjs';

async function project() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-i18n-'));
  assert.equal((await run(['init', 'game'], parent)).code, 0);
  return path.join(parent, 'game');
}

test('lgui i18n extract：提取固定文字到默认语言的文本表，默认语言原文跟着 ui/ 更新，新增的追加，ui/ 里没了的只报告', async () => {
  const root = await project();
  const zh = path.join(root, 'i18n/zh-CN.json');
  const first = JSON.parse((await run(['i18n', 'extract', '--json'], root)).stdout);
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const table = JSON.parse(fs.readFileSync(zh, 'utf8'));
  assert.equal(table['Main/MainView/title'], '你好，LGUI');
  assert.equal(table['Main/MainView/button'], '点我');
  assert.equal(table['Common/Confirm/ok'], '确定');
  assert.equal(table['main.hint'], '点下面的按钮试试', '代码里用的键不动');
  // 默认语言的原文以 ui/ 为准：表里改了会被改回来；ui/ 里改了，表跟着改，并报告「原文改了」
  table['Main/MainView/title'] = '改过的';
  fs.writeFileSync(zh, JSON.stringify(table));
  const second = JSON.parse((await run(['i18n', 'extract', '--json'], root)).stdout);
  assert.deepEqual([second.data.added, second.data.changed, JSON.parse(fs.readFileSync(zh, 'utf8'))['Main/MainView/title']], [[], ['Main/MainView/title'], '你好，LGUI']);
  const mainXml = path.join(root, 'ui/assets/Main/MainView.xml');
  fs.writeFileSync(mainXml, fs.readFileSync(mainXml, 'utf8').replace('text="你好，LGUI"', 'text="欢迎"'));
  const renamed = JSON.parse((await run(['i18n', 'extract', '--json'], root)).stdout);
  assert.deepEqual([renamed.data.changed, JSON.parse(fs.readFileSync(zh, 'utf8'))['Main/MainView/title']], [['Main/MainView/title'], '欢迎']);
  // 删掉标题控件：键只报告，不删
  for (const f of ['MainView.xml', 'MainView@portrait.xml']) {
    const xml = path.join(root, 'ui/assets/Main', f);
    fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace(/<text id="n1" name="title"[\s\S]*?<\/text>\n/, ''));
  }
  const third = JSON.parse((await run(['i18n', 'extract', '--json'], root)).stdout);
  assert.deepEqual(third.data.stale, ['Main/MainView/title']);
  assert.ok('Main/MainView/title' in JSON.parse(fs.readFileSync(zh, 'utf8')));
});

test('翻译文件：名字是 <包ID><组件ID>-<元素ID>，竖版和横版共用一个键；翻译文件和对照表写进 .lgui/build/i18n/', async () => {
  const root = await project();
  await run(['i18n', 'extract'], root);
  const en = path.join(root, 'i18n/en.json');
  fs.writeFileSync(en, JSON.stringify({...JSON.parse(fs.readFileSync(en, 'utf8')), 'Main/MainView/button': 'Click me'}));
  await run(['i18n', 'extract'], root);
  const xml = fs.readFileSync(path.join(root, '.lgui/build/i18n/en.xml'), 'utf8');
  assert.match(xml, /<string name="main0001mainvw01-n2">Click me<\/string>/);
  assert.match(xml, /<string name="main0001mainvw02-n2">Click me<\/string>/);
  const map = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/i18n/map.json'), 'utf8'));
  assert.deepEqual(map['Main/MainView/button'], ['main0001mainvw01-n2', 'main0001mainvw02-n2']);
});

test('运行时切换语言（headless，lgui test）：固定文字、lgui.t 文字都变；数据保留', async () => {
  const root = await project();
  await run(['i18n', 'extract'], root);
  const en = path.join(root, 'i18n/en.json');
  fs.writeFileSync(en, JSON.stringify({...JSON.parse(fs.readFileSync(en, 'utf8')), 'Main/MainView/button': 'Click me', 'Main/MainView/title': 'Hello'}));
  fs.writeFileSync(path.join(root, 'tests/lang.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';

test('中文 → 英文', async () => {
  const t = await lgui.testing.start(app);
  await t.click('Main/MainView.button');
  assert.equal(t.text('Main/MainView.status'), '点了 1 次');
  await t.setLanguage('en');
  assert.equal(t.text('Main/MainView.title'), 'Hello');
  assert.equal(t.text('Main/MainView.button'), 'Click me');
  assert.equal(t.text('Main/MainView.status'), 'Clicked 1 times');
  assert.equal(t.snapshot().language, 'en');
  await assert.rejects(t.setLanguage('fr'), (e: unknown) => (e as { code: string }).code === 'LGUI-RT-140');
  t.end();
});
`);
  const result = await run(['test', '--json'], root);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true, JSON.stringify(json.errors, null, 1));
  assert.equal(json.data.passed, 2);
});

test('lgui i18n extract：多行文字（XML 里写成 &#xA; 或 &#10;）提取成真的换行，不写成字面的 &#xA;；&amp;#xA; 还是原样的文字', async () => {
  const root = await project();
  for (const f of ['MainView.xml', 'MainView@portrait.xml']) {
    const xml = path.join(root, 'ui/assets/Main', f);
    fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace('text="你好，LGUI"', 'text="第一行&#xA;第二行&#10;第三行 &amp;#xA; &lt;b&gt;"'));
  }
  const result = JSON.parse((await run(['i18n', 'extract', '--json'], root)).stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const raw = fs.readFileSync(path.join(root, 'i18n/zh-CN.json'), 'utf8');
  assert.equal(JSON.parse(raw)['Main/MainView/title'], '第一行\n第二行\n第三行 &#xA; <b>');
  assert.ok(raw.includes('"第一行\\n第二行\\n第三行 &#xA; <b>"'), raw);
  // 横竖两版一样（换行也算），不报 LGUI-UI-063
  const check = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.ok(!check.data.findings.some(f => f.code === 'LGUI-UI-063'), JSON.stringify(check.data.findings));
});
