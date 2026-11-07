// lgui.platform.clipboard：headless 存在内存里，h5 用 navigator.clipboard，Unity 用 UnityEngine.GUIUtility.systemCopyBuffer。
// 游戏代码只用 lgui.platform.clipboard；用不了时 Promise 失败（LGUI-RT-241），用 lgui.request 包一层拿到 { ok }。
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {started} from '../../helpers/framework.mjs';
import {importTs} from '../../helpers/ts.mjs';

test('headless：写进去的文字读得出来，测试里能直接读 state.clipboard，也能先放好', async () => {
  const {fw, backend} = await started();
  const {lgui} = fw;
  assert.equal(await lgui.platform.clipboard.readText(), '', '一开始是空的');
  await lgui.platform.clipboard.writeText('UID-10086');
  assert.equal(backend.state.clipboard, 'UID-10086');
  assert.equal(await lgui.platform.clipboard.readText(), 'UID-10086');
  backend.state.clipboard = '邀请码 ABC';
  assert.equal(await lgui.platform.clipboard.readText(), '邀请码 ABC');
});

test('Controller 里用 lgui.request 包一层：失败时拿到 { ok: false } 和 LGUI-RT-241（记 warn），不抛', async () => {
  const {fw, backend} = await started({config: {requestErrorToast: false}});
  const {lgui, LgRuntimeError} = fw;
  const copy = lgui.request(text => lgui.platform.clipboard.writeText(text));
  assert.equal((await copy.run('a')).ok, true);
  backend.platform.clipboard.writeText = async () => { throw new LgRuntimeError('LGUI-RT-241', '剪贴板写入失败：被拒绝', '允许'); };
  const r = await copy.run('b');
  assert.deepEqual([r.ok, r.error.code], [false, 'LGUI-RT-241']);
  assert.ok(backend.state.logs.some(l => l.level === 'warn' && l.event === 'lgui_rt_241'));
});

test('lgui.app({ platform: { clipboard } }) 换掉后端自带的剪贴板', async () => {
  const written = [];
  const clipboard = {writeText: async text => { written.push(text); }, readText: async () => 'from host'};
  const {fw, backend} = await started({app: {platform: {clipboard}}});
  const {lgui} = fw;
  await lgui.platform.clipboard.writeText('x');
  assert.deepEqual([written, await lgui.platform.clipboard.readText(), backend.state.clipboard], [['x'], 'from host', '']);
});

const unityEntry = fileURLToPath(new URL('../../../plugin/framework/backends/unity/adapter/platform.ts', import.meta.url));
const h5Entry = fileURLToPath(new URL('../../../plugin/framework/backends/h5/platform/clipboard.ts', import.meta.url));

function unityOptions(clipboard) {
  const listener = {AddCapture() {}, RemoveCapture() {}};
  const host = {Now: 0, ScreenWidth: 100, ScreenHeight: 100, SafeAreaTop: 0, SafeAreaRight: 0, SafeAreaBottom: 0, SafeAreaLeft: 0, IsComposing: false, SystemLanguage: 'zh-CN', InputMode: 'ui', WheelDeltaX: 0, Log() {}};
  return {projectName: 'p', uiBase: 'UI', host, fgui: {Stage: {touchScreen: false, inst: listener}, GRoot: {inst: {}}, UIPackage: {}}, objects: {}, createLoader() {}, scale: {value: 1}, clipboard};
}

test('Unity：读写 UnityEngine.GUIUtility.systemCopyBuffer；运行环境里没有它时报 LGUI-RT-241', async () => {
  const {createUnityPlatform} = await importTs(unityEntry);
  const native = {systemCopyBuffer: 'old'};
  const {platform, dispose} = createUnityPlatform(unityOptions(() => native));
  assert.equal(await platform.clipboard.readText(), 'old');
  await platform.clipboard.writeText('UID-1');
  assert.equal(native.systemCopyBuffer, 'UID-1');
  dispose();
  await assert.rejects(platform.clipboard.readText(), e => e.code === 'LGUI-RT-027', '后端停止以后照常报 RT-027');
  const missing = createUnityPlatform(unityOptions(() => null));
  await assert.rejects(missing.platform.clipboard.writeText('x'), e => e.code === 'LGUI-RT-241' && /GUIUtility/.test(e.message));
  missing.dispose();
});

test('h5：用 navigator.clipboard；没有它（不是 https 页面）、浏览器拒绝时报 LGUI-RT-241', async t => {
  const {createH5Clipboard} = await importTs(h5Entry);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
  let stored = 'old';
  let deny = false;
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {clipboard: {
    writeText: async text => { if (deny) throw Object.assign(new Error('Document is not focused.'), {name: 'NotAllowedError'}); stored = text; },
    readText: async () => { if (deny) throw Object.assign(new Error('Read permission denied.'), {name: 'NotAllowedError'}); return stored; }
  }}});
  const clipboard = createH5Clipboard();
  assert.equal(await clipboard.readText(), 'old');
  await clipboard.writeText('UID-2');
  assert.equal(stored, 'UID-2');
  deny = true;
  await assert.rejects(clipboard.writeText('x'), e => e.code === 'LGUI-RT-241' && /NotAllowedError/.test(e.message));
  await assert.rejects(clipboard.readText(), e => e.code === 'LGUI-RT-241' && /读取/.test(e.message));
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {}});
  await assert.rejects(clipboard.writeText('x'), e => e.code === 'LGUI-RT-241' && /navigator\.clipboard/.test(e.message));
});
