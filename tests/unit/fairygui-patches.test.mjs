// FairyGUI-dom 补丁结构：生成文件 = 上游原文件 + .patch（逐行对上，对不上就报错）；钩子装的时候目标不在就报 LGUI-RT-230 / 231。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyPatch, staleFairyGui, patchFiles} from '../../scripts/fairygui-dom/build.mjs';
import {importTs} from '../helpers/ts.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));

test('生成的 fairygui.module.js 和「上游原文件 + 全部 .patch」一致', () => {
  assert.deepEqual(staleFairyGui(), []);
  assert.deepEqual(patchFiles().map(f => path.basename(f)), ['5-safari-custom-elements.patch', '6-load-package-reject.patch']);
});

test('.patch 按原位置逐行对上才打，上游改过就停下报错', () => {
  const upstream = ['a', 'b', 'c', 'd', 'e'].join('\n');
  const patch = ['--- a/x', '+++ b/x', '@@ -2,3 +2,3 @@', ' b', '-c', '+C', ' d', ''].join('\n');
  assert.equal(applyPatch(upstream, patch, 'p'), ['a', 'b', 'C', 'd', 'e'].join('\n'));
  // 上游第 3 行变了
  assert.throws(() => applyPatch(['a', 'b', 'x', 'd', 'e'].join('\n'), patch, '7-demo.patch'), /7-demo\.patch 第 1 段对不上：上游第 3 行应该是「c」，实际是「x」/);
  // 上游往前挪了一行：不做模糊匹配
  assert.throws(() => applyPatch(['z', 'a', 'b', 'c', 'd', 'e'].join('\n'), patch, 'p'), /对不上/);
  // 段头行数和内容对不上
  assert.throws(() => applyPatch(upstream, patch.replace('-2,3', '-2,4'), 'p'), /段头写了 4 行原文，实际有 3 行/);
  // CRLF 的行原样保留
  assert.equal(applyPatch('a\r\nb\nc', ['@@ -2 +2 @@', '-b', '+B', ''].join('\n'), 'p'), 'a\r\nB\nc');
});

test('钩子：先调上游原方法再补；目标不在报 LGUI-RT-230，要加的上游已经有了报 LGUI-RT-231', async () => {
  const hook = await importTs(path.join(repo, 'plugin/framework/backends/h5/fairygui-patches/hook.ts'));
  const calls = [];
  class Upstream { run(x) { calls.push(['up', x]); return x * 2; } get value() { return 1; } set value(v) { calls.push(['set', v]); } }
  hook.after(1, Upstream.prototype, 'Upstream', 'run', (self, args, result) => calls.push(['ours', args[0], result]));
  assert.equal(new Upstream().run(3), 6);
  assert.deepEqual(calls, [['up', 3], ['ours', 3, 6]]);

  calls.length = 0;
  hook.accessor(1, Upstream.prototype, 'Upstream', 'value', {get: () => 42, set: (self, v) => calls.push(['ours', v])});
  const o = new Upstream();
  o.value = 5;
  assert.equal(o.value, 42);
  assert.deepEqual(calls, [['set', 5], ['ours', 5]]);

  const error = (fn, code, pattern) => assert.throws(fn, e => e.code === code && pattern.test(e.message));
  error(() => hook.after(7, Upstream.prototype, 'TextField', 'applyFormat', () => {}), 'LGUI-RT-230', /补丁 7 装不上：上游没有 TextField\.applyFormat\(\) 了.*PATCHES\.md 第 7 条/);
  error(() => hook.accessor(1, Upstream.prototype, 'Image', 'fillAmount', {}), 'LGUI-RT-230', /Image\.fillAmount 属性/);
  error(() => hook.fields(9, {}, 'GButton', ['_downEffect']), 'LGUI-RT-230', /GButton 的字段 _downEffect/);
  error(() => hook.add(2, Upstream, 'Upstream', 'name', () => {}), 'LGUI-RT-231', /补丁 2 要加的 Upstream\.name 上游已经有了/);
  hook.add(2, Upstream, 'Upstream', 'setImageManifest', () => 'ok');
  assert.equal(Upstream.setImageManifest(), 'ok');
});
