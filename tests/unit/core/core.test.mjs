import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {typecheck, importTs} from '../../helpers/ts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, '../../../plugin/framework/core');
const coreFiles = fs.readdirSync(core).filter(f => f.endsWith('.ts')).map(f => path.join(core, f));

test('接口层在 strict 下类型检查通过，假后端能完整实现它', () => {
  assert.deepEqual(typecheck([...coreFiles, path.join(here, 'fake-backend.ts')]), []);
  assert.deepEqual(typecheck([path.resolve(here, '../../../plugin/framework/host.ts')], {lib: ['es2020', 'dom']}), []);
});

test('接口层不用 any，每个导出的接口成员都有一句说明', () => {
  const hostFile = path.resolve(here, '../../../plugin/framework/host.ts');
  for (const file of [...coreFiles, hostFile]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /:\s*any\b|<any>|as any\b/, path.basename(file));
  }
  // ui.ts、platform.ts、host.ts 里每个成员上一行都是 /** … */ 说明。
  for (const [dir, name] of [[core, 'ui.ts'], [core, 'platform.ts'], [path.dirname(hostFile), 'host.ts']]) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^ {2}(readonly )?[a-zA-Z]+[?(:]/.test(line)) assert.match(lines[i - 1], /\/\*\*.*\*\//, `${name}:${i + 1} 缺说明`);
    });
  }
});

test('事件订阅返回取消函数，取消后不再收到', async () => {
  const {createFakeBackend, FakeComponent} = await importTs(path.join(here, 'fake-backend.ts'));
  const backend = createFakeBackend();
  const view = backend.create('Main', 'MainView');
  assert.ok(view instanceof FakeComponent);
  const seen = [];
  const off = view.tabs.onChange(page => seen.push(page));
  view.tabs.selectedPage = 'b';
  off();
  view.tabs.selectedPage = 'a';
  assert.deepEqual(seen, ['b']);
  assert.equal(view.tabs.changes.size, 0);
});

test('LgRuntimeError 带错误码和下一步；notImplemented 报 LGUI-RT-001', async () => {
  const {createFakeBackend} = await importTs(path.join(here, 'fake-backend.ts'));
  const backend = createFakeBackend();
  assert.throws(() => backend.create('Nope', 'X'), error => error.code === 'LGUI-RT-002' && error.next === '先加载这个包。');
  assert.throws(() => backend.platform.net.fetch('/x'), error => error.code === 'LGUI-RT-001' && /fake 后端还没实现「网络」/.test(error.message));
});
