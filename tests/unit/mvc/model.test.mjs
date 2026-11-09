import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importTs, typecheck} from '../../helpers/ts.mjs';

const mvc = fileURLToPath(new URL('../../../plugin/framework/mvc', import.meta.url));

async function load() {
  const entry = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-mvc-')), 'entry.ts');
  fs.writeFileSync(entry, ['lgui', 'pick', 'scope', 'model'].map(m => `export * from ${JSON.stringify(path.join(mvc, m + '.ts'))};`).join('\n'));
  return importTs(entry);
}

test('zustand vanilla、Model、pick、清理清单在 strict 下类型检查通过', () => {
  assert.deepEqual(typecheck(['vendor/zustand-vanilla.ts', 'model.ts', 'pick.ts', 'scope.ts', 'index.ts'].map(f => path.join(mvc, f))), []);
});

test('zustand vanilla 保留 MIT 许可和署名', () => {
  const text = fs.readFileSync(path.join(mvc, 'vendor/zustand-vanilla.ts'), 'utf8');
  assert.match(text, /MIT License/);
  assert.match(text, /Copyright \(c\) 2019 Paul Henschel/);
});

test('Model：读、只改部分字段、规则方法挂在 Model 上', async () => {
  const {lgui} = await load();
  const bag = lgui.Model({gold: 0, items: ['a', 'b'], selected: null}, (set, get) => ({
    select(id) { set({selected: id}); },
    removeSelected() { set({items: get().items.filter(i => i !== get().selected), selected: null}); }
  }));
  bag.set({gold: 5});
  assert.deepEqual(bag.get(), {gold: 5, items: ['a', 'b'], selected: null});
  bag.select('a');
  bag.removeSelected();
  assert.deepEqual(bag.get(), {gold: 5, items: ['b'], selected: null});
});

test('pick 按字段监听：只改金币时，监听道具列表的 pick 不触发', async () => {
  const {lgui, pick} = await load();
  const bag = lgui.Model({gold: 0, items: []});
  const goldText = pick(bag, s => s.gold, n => `${n} 金币`);
  const items = pick(bag, s => s.items);
  let goldFired = 0, itemsFired = 0;
  goldText.subscribe(() => goldFired++);
  items.subscribe(() => itemsFired++);
  bag.set({gold: 10});
  bag.set({gold: 10});
  assert.deepEqual([goldFired, itemsFired, goldText.get()], [1, 0, '10 金币']);
  bag.set({items: ['x']});
  assert.deepEqual([goldFired, itemsFired], [1, 1]);
});

test('界面关闭后订阅全部取消（订阅数归零）', async () => {
  const {lgui, pick, Scope, listenerCount} = await load();
  const bag = lgui.Model({gold: 0, items: []});
  const scope = new Scope();
  for (const select of [s => s.gold, s => s.items, s => s.items.length]) scope.add(pick(bag, select).subscribe(() => {}));
  assert.equal(listenerCount(bag), 3);
  assert.equal(scope.size, 3);
  scope.dispose();
  assert.equal(listenerCount(bag), 0);
  // 关闭之后再登记的，立刻取消
  scope.add(pick(bag, s => s.gold).subscribe(() => {}));
  assert.equal(listenerCount(bag), 0);
});

test('pick 也能读任何有 get 和 subscribe 的东西', async () => {
  const {pick} = await load();
  let value = {status: 'idle'};
  const listeners = new Set();
  const source = {get: () => value, subscribe: l => { listeners.add(l); return () => listeners.delete(l); }};
  const pending = pick(source, r => r.status === 'pending');
  let fired = 0;
  pending.subscribe(() => fired++);
  value = {status: 'pending'};
  for (const l of listeners) l();
  assert.deepEqual([fired, pending.get()], [1, true]);
});

test('一个订阅者出错：其余订阅者照常收到更新，全部通知完再抛出这个错误', async () => {
  const {lgui} = await load();
  const bag = lgui.Model({gold: 0});
  const got = [];
  bag.subscribe(() => { got.push('a'); throw new Error('a 坏了'); });
  bag.subscribe(() => got.push(`b:${bag.get().gold}`));
  assert.throws(() => bag.set({gold: 5}), /a 坏了/);
  assert.deepEqual(got, ['a', 'b:5']);
  assert.equal(bag.get().gold, 5);
});
