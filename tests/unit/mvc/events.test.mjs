import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importTs, typecheck} from '../../helpers/ts.mjs';

const framework = fileURLToPath(new URL('../../../plugin/framework', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-ev-'));

async function load() {
  const entry = path.join(tmp(), 'entry.ts');
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(framework, 'index.ts'))};\nexport {bus} from ${JSON.stringify(path.join(framework, 'mvc/events.ts'))};`);
  return importTs(entry);
}

test('A 关闭后 B 刷新：B 收听 viewClosed；B 关闭后收听自动取消', async () => {
  const {lgui, View, Controller, bus} = await load();
  class AView extends View {}
  let reloads = 0;
  class BController extends Controller { reload() { reloads++; } }
  const b = new BController();
  class BView extends View {
    onOpen() { this.on(lgui.events.viewClosed, e => { if (e.view === AView) b.reload(); }); }
  }
  const view = new BView();
  view.onOpen();
  lgui.emit(lgui.events.viewClosed, {view: AView});
  lgui.emit(lgui.events.viewClosed, {view: BView});
  assert.equal(reloads, 1);
  assert.equal(bus.count(lgui.events.viewClosed), 1);
  view.__scope.dispose();          // 框架关闭 B 时做的事
  assert.equal(bus.count(lgui.events.viewClosed), 0);
  lgui.emit(lgui.events.viewClosed, {view: AView});
  assert.equal(reloads, 1);
});

test('游戏自己的事件：声明、广播、Controller 里收听跟着整个游戏走；重复声明报 LGUI-RT-040', async () => {
  const {lgui, Controller} = await load();
  const rewardClaimed = lgui.defineEvent('rewardClaimed');
  const got = [];
  class TaskController extends Controller { constructor() { super(); this.on(rewardClaimed, e => got.push(e.id)); } }
  new TaskController();
  lgui.emit(rewardClaimed, {id: 'r1'});
  assert.deepEqual(got, ['r1']);
  assert.throws(() => lgui.defineEvent('rewardClaimed'), e => e.code === 'LGUI-RT-040');
  assert.deepEqual(Object.keys(lgui.events).sort(), ['inputModeChange', 'inputTypeChange', 'languageChange', 'orientationChange', 'viewClosed', 'viewCovered', 'viewOpened', 'viewRevealed']);
});

test('参数类型写错时类型检查报错', () => {
  const dir = tmp();
  const file = path.join(dir, 'use.ts');
  fs.writeFileSync(file, `import {lgui} from ${JSON.stringify(path.join(framework, 'index'))};
const rewardClaimed = lgui.defineEvent<{ id: string }>('x');
lgui.emit(rewardClaimed, { id: 'ok' });
lgui.emit(rewardClaimed, { id: 1 });
lgui.emit(lgui.events.languageChange, { lang: 'en' });
`);
  const errors = typecheck([file]);
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors[0], /use\.ts:4/);
  assert.match(errors[1], /use\.ts:5/);
});

test('一个收听函数出错：其余收听者照常收到，全部调完再抛出这个错误', async () => {
  const {lgui, bus} = await load();
  const ping = lgui.defineEvent('pingAfterError');
  const got = [];
  const offA = bus.on(ping, () => { got.push('a'); throw new Error('a 坏了'); });
  const offB = bus.on(ping, () => got.push('b'));
  assert.throws(() => lgui.emit(ping, {}), /a 坏了/);
  assert.deepEqual(got, ['a', 'b']);
  offA(); offB();
});
