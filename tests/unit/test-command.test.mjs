import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from './cli/helpers.mjs';
import {mp3} from '../helpers/fixture.mjs';

async function project() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-test-cmd-'));
  const r = await run(['init', 'game'], parent);
  assert.equal(r.code, 0, r.stderr);
  return path.join(parent, 'game');
}

test('lgui test：新建工程自带的测试能跑通（headless、打开主界面、点按钮、读文字）', async () => {
  const root = await project();
  const result = await run(['test', '--json'], root);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true, JSON.stringify(json.errors) + result.stderr);
  assert.deepEqual([json.data.passed, json.data.failed, json.data.files], [1, [], ['tests/main.test.ts']]);
});

test('lgui test：失败时退出码 1，报 LGUI-CLI-041 并附上测试结束时的界面快照', async () => {
  const root = await project();
  fs.writeFileSync(path.join(root, 'tests/broken.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';

test('故意失败', async () => {
  const t = await lgui.testing.start(app);
  await t.click('Main/MainView.button');
  assert.equal(t.text('Main/MainView.status'), '不会是这个');
});
`);
  const result = await run(['test'], root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /通过 1，失败 1/);
  assert.match(result.stderr, /LGUI-CLI-041  测试没通过：故意失败。原因：Expected values to be strictly equal: .*'不会是这个'.*。测试结束时的界面状态：\{"layers":\{"hud":\[\],"page":\["MainView"\]/);
});

test('lgui test：路径写错报 LGUI-RT-111；没有测试文件报 LGUI-CLI-040', async () => {
  const root = await project();
  fs.writeFileSync(path.join(root, 'tests/main.test.ts'), `import { test } from 'node:test';
import { lgui } from 'lgui';
import app from '../src/main';
test('路径写错', async () => { const t = await lgui.testing.start(app); t.text('Main/MainView.nope'); });
`);
  const result = await run(['test'], root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /LGUI-RT-111/);
  fs.rmSync(path.join(root, 'tests'), {recursive: true});
  const empty = JSON.parse((await run(['test', '--json'], root)).stdout);
  assert.equal(empty.errors[0].code, 'LGUI-CLI-040');
});

test('lgui test：测试文件一加载就出错（顶层抛错）也算失败，退出码 1，失败项是这个文件', async () => {
  const root = await project();
  fs.writeFileSync(path.join(root, 'tests/crash.test.ts'), `throw new Error('加载时出错');\n`);
  const result = await run(['test', '--json'], root);
  const json = JSON.parse(result.stdout);
  assert.equal(result.code, 1);
  assert.equal(json.ok, false);
  assert.equal(json.data.passed, 1);
  assert.deepEqual(json.data.failed.map(f => f.name), ['tests/crash.test.ts']);
  assert.equal(json.errors[0].code, 'LGUI-CLI-041');
});

test('lgui test：t.sounds() 是放过的音效，t.music() 是正在放的背景音乐；记了 error 级日志的测试判失败（LGUI-RT-176），warn 不算', async () => {
  const root = await project();
  const common = path.join(root, 'ui/assets/Common');
  fs.writeFileSync(path.join(common, 'click.mp3'), mp3());
  fs.writeFileSync(path.join(common, 'bgm.mp3'), mp3(40));
  const pkg = path.join(common, 'package.xml');
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('</resources>', '  <sound id="click001" name="click.mp3" path="/" exported="true"/>\n    <sound id="bgm00001" name="bgm.mp3" path="/" exported="true"/>\n  </resources>'));
  const view = path.join(root, 'src/modules/main/MainView.ts');
  fs.writeFileSync(view, fs.readFileSync(view, 'utf8').replace('static fullScreen = true;', "static fullScreen = true;\n  static music = 'ui://Common/bgm';"));
  fs.writeFileSync(path.join(root, 'tests/sound.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';

test('声音', async () => {
  const t = await lgui.testing.start(app);
  assert.equal(t.music(), 'ui://Common/bgm');
  lgui.sound.play('ui://Common/click', { volume: 0.5 });
  assert.deepEqual(t.sounds(), [{ url: 'ui://Common/click', volume: 0.5 }]);
  lgui.log.warn('slow_network', { ms: 900 });
  t.end();
  await t.advance(16);
  assert.equal(t.music(), null);
});

test('记了 error', async () => {
  const t = await lgui.testing.start(app);
  lgui.log.error('save_failed', new Error('磁盘满'));
  await t.advance(16);
});

test('最后才记 error', async () => {
  await lgui.testing.start(app);
  lgui.log.error('late_failure');
});
`);
  const result = await run(['test'], root);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /通过 2，失败 2/, result.stdout);
  assert.match(result.stdout, /失败：记了 error/);
  assert.match(result.stdout, /失败：最后才记 error/);
  assert.match(result.stdout, /LGUI-RT-176[^\n]*save_failed/);
});

test('lgui test 指定文件、目录和 --name：输出写清跑了几个、跳过几个、筛掉几个；写错的路径和匹配不到的名字报错', async () => {
  const root = await project();
  const header = "import { test, describe } from 'node:test';\nimport assert from 'node:assert/strict';\n";
  fs.writeFileSync(path.join(root, 'tests/a.test.ts'), `${header}test('甲 一', () => {});\ntest('乙 二', () => {});\n`);
  fs.mkdirSync(path.join(root, 'tests/sub'));
  fs.writeFileSync(path.join(root, 'tests/sub/b.test.ts'), `${header}describe('组', () => { test('甲 三', () => { assert.ok(true); }); test.skip('跳过', () => {}); });\n`);
  const json = async argv => JSON.parse((await run([...argv, '--json'], root)).stdout);
  const counts = j => [j.data.files, j.data.totalFiles, j.data.ran, j.data.passed, j.data.skipped, j.data.filtered];

  assert.deepEqual(counts(await json(['test'])), [['tests/a.test.ts', 'tests/main.test.ts', 'tests/sub/b.test.ts'], 3, 4, 4, 1, 0], 'describe 本身不算测试');
  assert.deepEqual(counts(await json(['test', 'tests/sub'])), [['tests/sub/b.test.ts'], 3, 1, 1, 1, 0]);
  assert.deepEqual(counts(await json(['test', 'tests/a.test.ts', 'tests/main.test.ts'])), [['tests/a.test.ts', 'tests/main.test.ts'], 3, 3, 3, 0, 0]);
  assert.deepEqual(counts(await json(['test', '--name', '甲'])).slice(2), [2, 2, 0, 3]);
  assert.deepEqual(counts(await json(['test', '--name', '组'])).slice(2), [1, 1, 1, 3], 'describe 的名字匹配时里面的测试都跑');
  const text = await run(['test', 'tests/sub', '--name', '甲'], root);
  assert.match(text.stdout, /跑了 1 个测试文件（tests\/ 里一共 3 个）、1 个测试：通过 1，失败 0；按 --name 筛掉 1。/);

  assert.equal((await json(['test', 'tests/nope.test.ts'])).errors[0].code, 'LGUI-CLI-130');
  assert.equal((await json(['test', 'src'])).errors[0].code, 'LGUI-CLI-130');
  assert.equal((await json(['test', 'src/main.ts'])).errors[0].code, 'LGUI-CLI-130');
  const none = await json(['test', '--name', '没有这个']);
  assert.deepEqual([none.ok, none.errors[0].code], [false, 'LGUI-CLI-131']);
});

test('lgui test：一个测试在 t.end() 前断言失败，留下的界面和广播在测试结束时清掉，同一个文件后面的测试不受连带；通过了却没调 t.end() 的照样查泄漏', async () => {
  const root = await project();
  fs.writeFileSync(path.join(root, 'src/modules/main/ping.ts'), "import { lgui } from 'lgui';\nexport const ping = lgui.defineEvent<{ n: number }>('ping');\nexport const heard: number[] = [];\n");
  const view = path.join(root, 'src/modules/main/MainView.ts');
  fs.writeFileSync(view, fs.readFileSync(view, 'utf8')
    .replace("import { mainController } from './MainController';", "import { mainController } from './MainController';\nimport { ping, heard } from './ping';")
    .replace("keys: Keys = { back: 'none' };", "keys: Keys = { back: 'none' };\n  onOpen() { this.on(ping, e => heard.push(e.n)); }"));
  fs.writeFileSync(path.join(root, 'tests/main.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';
import { ping, heard } from '../src/modules/main/ping';

test('A 断言失败，没走到 t.end()', async () => {
  await lgui.testing.start(app);
  assert.equal(t1(), 2);
});
const t1 = () => 1;

test('B 只有这个测试的界面收到广播', async () => {
  const t = await lgui.testing.start(app);
  heard.length = 0;
  lgui.emit(ping, { n: 1 });
  assert.deepEqual(heard, [1]);
  t.end();
});

test('C 通过了但没调 t.end()', async () => {
  await lgui.testing.start(app);
});
`);
  const json = JSON.parse((await run(['test', '--json'], root)).stdout);
  assert.deepEqual(json.data.results.map(r => [r.name, r.ok]), [['A 断言失败，没走到 t.end()', false], ['B 只有这个测试的界面收到广播', true], ['C 通过了但没调 t.end()', true]], JSON.stringify(json.errors));
});

test('lgui test：通过了、没调 t.end()、又留下了没关的界面：lgui test 补调的 end() 让它失败（LGUI-RT-112），同一个文件后面的测试不受连带', async () => {
  const root = await project();
  // 框架自己的打开、关闭路径都会把界面和包清干净；这里把这次测试的关闭换成什么都不做，模拟一个关不掉的界面。
  fs.writeFileSync(path.join(root, 'tests/main.test.ts'), `import { test } from 'node:test';
import { lgui } from 'lgui';
import app from '../src/main';

test('A 通过了、没调 t.end()、主界面关不掉', async () => {
  const t = await lgui.testing.start(app);
  (t as unknown as { ui: { closeAll(layer: string): void } }).ui.closeAll = () => {};
});

test('B 后面的测试照常', async () => {
  const t = await lgui.testing.start(app);
  t.end();
});
`);
  const r = await run(['test', '--json'], root);
  const json = JSON.parse(r.stdout);
  assert.equal(r.code, 1);
  assert.deepEqual(json.data.results.map(x => [x.name, x.ok]), [['A 通过了、没调 t.end()、主界面关不掉', false], ['B 后面的测试照常', true]], JSON.stringify(json.data.failed));
  assert.match(json.data.failed[0].error, /LGUI-RT-112.*MainView/);
});

test('lgui test：配了 uiCache.keepClosedViews 时 t.end() 先清掉界面缓存再查泄漏，不报假的 LGUI-RT-112', async () => {
  const root = await project();
  const config = path.join(root, '.lgui/project.json');
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('"uiCache": {"keepClosedViews": 0}', '"uiCache": {"keepClosedViews": 3}'));
  assert.match(fs.readFileSync(config, 'utf8'), /"keepClosedViews": 3/);
  const json = JSON.parse((await run(['test', '--json'], root)).stdout);
  assert.equal(json.ok, true, JSON.stringify(json.errors));
});

test('lgui test：headless 不算布局，lgui.ui.find 读到受关联影响的位置和尺寸报 LGUI-RT-260；界面本身和框架摆的 safe 照常读', async () => {
  const root = await project();
  fs.writeFileSync(path.join(root, 'tests/main.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';

test('find', async () => {
  const t = await lgui.testing.start(app);
  assert.throws(() => lgui.ui.find('Main/MainView.button'), e => e.code === 'LGUI-RT-260' && /button 的位置由关联（relation center-center）决定/.test(e.message));
  assert.throws(() => lgui.ui.find('Main/MainView.bg'), e => e.code === 'LGUI-RT-260' && /bg 的尺寸由关联（relation width-width）决定/.test(e.message));
  assert.deepEqual(lgui.ui.find('Main/MainView'), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(lgui.ui.find('Main/MainView.safe'), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(lgui.ui.find('Main/MainView.nope'), null);
  t.end();
});
`);
  const json = JSON.parse((await run(['test', '--json'], root)).stdout);
  assert.equal(json.ok, true, JSON.stringify(json.data.failed));
});
