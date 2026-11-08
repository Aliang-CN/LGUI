// Unity 端项目字体改用 TMP 的静态部分（本机没有 Unity，编译和运行在 tests/unity/fonts/ 里跑）：
// FairyGUI.asmdef 只多了打开 FAIRYGUI_TMPRO 的 versionDefines（台账 plugin/framework/backends/unity/PATCHES.md）；
// LGUI.Runtime 引用 TMP；两份材质让出包时带上 FairyGUI 的 TMP shader 和投影用的 UNDERLAY_ON 变体；验收检查器能分出对错。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {checkFontResult} from '../../unity/fonts/checker.mjs';

const pkg = fileURLToPath(new URL('../../../plugin/framework/backends/unity/package/', import.meta.url));
const read = rel => fs.readFileSync(pkg + rel, 'utf8');

// 上游 FairyGUI-unity 提交 8cc8f214 的 Assets/Scripts/FairyGUI.asmdef（SHA-256 b3f4133b…，见 PATCHES.md）
const upstream = {name: 'FairyGUI', rootNamespace: '', references: ['Unity.TextMeshPro'], includePlatforms: [], excludePlatforms: [], allowUnsafeCode: false, overrideReferences: false, precompiledReferences: [], autoReferenced: true, defineConstraints: [], versionDefines: [], noEngineReferences: false};

test('FairyGUI.asmdef 只改了 versionDefines：装了 com.unity.ugui 2.0.0 及以上时定义 FAIRYGUI_TMPRO', () => {
  const asmdef = JSON.parse(read('FairyGUI/FairyGUI.asmdef'));
  assert.deepEqual(asmdef.versionDefines, [{name: 'com.unity.ugui', expression: '2.0.0', define: 'FAIRYGUI_TMPRO'}]);
  assert.deepEqual({...asmdef, versionDefines: []}, upstream);
  assert.deepEqual(JSON.parse(read('package.json')).dependencies['com.unity.ugui'], '2.0.0', 'LGUI 包依赖 ugui 2.0.0，FAIRYGUI_TMPRO 总是打开');
  assert.ok(JSON.parse(read('Runtime/LGUI.Runtime.asmdef')).references.includes('Unity.TextMeshPro'));
});

test('两份材质放在 Resources 里，引用 FairyGUI 的 TMP shader：出包时带上 shader，以及无投影和 UNDERLAY_ON（投影）两个变体', () => {
  const shaderGuid = /guid: ([0-9a-f]{32})/.exec(read('FairyGUI/Extensions/TextMeshPro/Shaders/FairyGUI-TMP.shader.meta'))[1];
  assert.match(read('FairyGUI/Extensions/TextMeshPro/Shaders/FairyGUI-TMP.shader'), /^Shader "FairyGUI\/TextMeshPro\/Distance Field"/);
  assert.match(read('FairyGUI/Extensions/TextMeshPro/TMPFont.cs'), /this\.shader = "FairyGUI\/TextMeshPro\/Distance Field";/);
  assert.match(read('FairyGUI/Extensions/TextMeshPro/TMPFont.cs'), /ToggleKeyword\("UNDERLAY_ON", true\)/);
  for (const [file, keywords] of [['FairyGUI-TMP', '[]'], ['FairyGUI-TMP-Underlay', '\n  - UNDERLAY_ON']]) {
    const mat = read(`Runtime/Resources/LGUI/${file}.mat`);
    assert.match(mat, new RegExp(`m_Shader: \\{fileID: 4800000, guid: ${shaderGuid}, type: 3\\}`));
    assert.ok(mat.includes(`m_ValidKeywords:${keywords === '[]' ? ' []' : keywords}\n`), file);
    assert.match(read(`Runtime/Resources/LGUI/${file}.mat.meta`), /mainObjectFileID: 2100000/);
  }
  for (const meta of ['Runtime/Resources.meta', 'Runtime/Resources/LGUI.meta']) assert.match(read(meta), /folderAsset: yes/);
});

test('C#：项目字体建动态多图集的 TMP 字体、包成 TMPFont 按名字注册；系统回退字体挂在 fallbackFontAssetTable 上', () => {
  const cs = read('Runtime/Platform/Fonts.cs');
  assert.match(cs, /TMP_FontAsset\.CreateFontAsset\(font, SamplingPointSize, AtlasPadding, GlyphRenderMode\.SDFAA,\s+AtlasSize, AtlasSize, AtlasPopulationMode\.Dynamic, true\)/);
  assert.match(cs, /TMP_FontAsset\.CreateFontAsset\(candidate\[0\], candidate\[1\], SamplingPointSize\)/);
  assert.match(cs, /asset\.fallbackFontAssetTable = new List<TMP_FontAsset> \{ _fallback \}/);
  assert.match(cs, /FontManager\.RegisterFont\(tmp, name\)/);
  // 缺 TMP Settings 时 TMP 建字体会空引用：先查，直接按名字从 Resources 读（不经 TMP_Settings.instance，它在编辑器里会弹导入窗口）
  assert.match(cs, /public static bool TmpSettingsFound\s*\{\s*get \{ return Resources\.Load<TMP_Settings>\("TMP Settings"\) != null; \}/);
  for (const family of ['PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei']) assert.ok(cs.includes(`"${family}"`), family);
});

test('tests/unity/fonts 的检查器：对的结果通过；回退字体没出字、注册成了别的字体、找不到字体不报错都不通过', () => {
  const good = {missing: {rejected: true, code: 'LGUI-RT-181', message: '项目字体 Missing 在 Unity 的 Resources 里找不到（Resources/UI/fonts/Missing.ttf 或 .otf）'},
    registered: 'TMPFont:Noto', atlas: 'Dynamic,True,1', drawnWith: 'TMPFont:Noto', inFontServedBy: ['Noto', 'Noto'], fallbackName: 'Microsoft YaHei', fallbackCandidates: 'PingFang SC, Microsoft YaHei',
    notInFontServedBy: 'Microsoft YaHei', firstLayoutMs: 3.2, secondLayoutMs: 0.4};
  checkFontResult(good);
  for (const bad of [{notInFontServedBy: 'Noto'}, {notInFontServedBy: ''}, {registered: 'DynamicFont:Noto'}, {drawnWith: 'DynamicFont:Noto'}, {missing: {rejected: false}}, {atlas: 'Static,False,1'}, {fallbackName: ''}]) {
    assert.throws(() => checkFontResult({...good, ...bad}), undefined, JSON.stringify(bad));
  }
});
