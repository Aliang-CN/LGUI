import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {run} from '../cli/helpers.mjs';
import {createUnityProject, puertsOriginalHash, puertsPatchedHash} from '../../helpers/unity.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const packageSource = path.join(repo, 'plugin/framework/backends/unity/package');
const patchPath = unity => path.join(unity, 'Packages/com.tencent.puerts.core/Editor/Resources/puerts/xil2cpp/Puerts_il2cpp.cpp.txt');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = (root, name) => path.join(root, 'Packages', name, 'package.json');
const exportTo = async (ctx, extra = []) => {
  const result = await run(['unity', 'export', '--to', ctx.unity, ...extra, '--json'], ctx.root);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, result.stdout);
  return {...result, json: JSON.parse(lines[0])};
};
const files = dir => !fs.existsSync(dir) ? {} : Object.fromEntries(fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? Object.entries(files(file)).map(([key, value]) => [entry.name + '/' + key, value]) : [[entry.name, hash(file)]];
}));
async function context(options) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-export-'));
  const init = await run(['init', 'game'], parent);
  assert.equal(init.code, 0, init.stderr);
  return {parent, root: path.join(parent, 'game'), unity: createUnityProject(path.join(parent, 'Unity 中文 Project'), options)};
}
function assertFailure(result, code) {
  assert.equal(result.code, 1, result.stdout);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.command, 'unity export');
  assert.equal(result.json.errors[0].code, code, result.stdout);
  assert.equal(typeof result.json.errors[0].fix, 'string');
}

test('Unity export：--to 必填，不接受额外位置参数', async () => {
  const c = await context();
  const missing = await run(['unity', 'export', '--json'], c.root);
  assert.equal(JSON.parse(missing.stdout).errors[0].code, 'LGUI-CLI-006');
  assertFailure(await exportTo(c, ['unexpected']), 'LGUI-CLI-006');
});

test('Unity export：目标必须是 Unity 6000.6.x，失败不写目标或工程配置', async () => {
  const c = await context({version: '6000.5.1f1'});
  const before = files(c.unity), config = read(c.root, '.lgui/project.json');
  assertFailure(await exportTo(c), 'LGUI-CLI-052');
  assert.deepEqual(files(c.unity), before);
  assert.equal(read(c.root, '.lgui/project.json'), config);
});

for (const name of ['com.tencent.puerts.core', 'com.tencent.puerts.v8']) {
  test('Unity export：' + name + ' 缺失或错版时报 051，不改原 CPP', async () => {
    const c = await context();
    const file = manifest(c.unity, name);
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    pkg.version = '3.0.2';
    fs.writeFileSync(file, JSON.stringify(pkg));
    assertFailure(await exportTo(c), 'LGUI-CLI-051');
    assert.equal(hash(patchPath(c.unity)), puertsOriginalHash);
    fs.unlinkSync(file);
    assertFailure(await exportTo(c), 'LGUI-CLI-051');
    assert.equal(fs.existsSync(path.join(c.unity, 'Assets')), false);
  });
}

test('Unity export：PackageCache 或包目录链接不算工程内 embedded 本地包', async () => {
  const c = await context();
  const core = path.join(c.unity, 'Packages/com.tencent.puerts.core');
  const cached = path.join(c.unity, 'Library/PackageCache/com.tencent.puerts.core@3.0.3');
  fs.mkdirSync(path.dirname(cached), {recursive: true});
  fs.renameSync(core, cached);
  fs.symlinkSync(cached, core, 'junction');
  assertFailure(await exportTo(c), 'LGUI-CLI-051');
  assert.equal(hash(path.join(cached, 'Editor/Resources/puerts/xil2cpp/Puerts_il2cpp.cpp.txt')), puertsOriginalHash);
  assert.equal(fs.existsSync(path.join(c.unity, 'Assets')), false);
});

test('Unity export：未知 PuerTS 内容不能硬打补丁，也不能覆盖原产物', async () => {
  const c = await context();
  fs.appendFileSync(patchPath(c.unity), '// changed\n');
  fs.mkdirSync(path.join(c.unity, 'Assets/LGUI/Resources/UI'), {recursive: true});
  fs.writeFileSync(path.join(c.unity, 'Assets/LGUI/Resources/UI/keep.bytes'), 'old');
  const before = files(c.unity), config = read(c.root, '.lgui/project.json');
  assertFailure(await exportTo(c), 'LGUI-CLI-051');
  assert.deepEqual(files(c.unity), before);
  assert.equal(read(c.root, '.lgui/project.json'), config);
});

test('Unity export：已有 LGUI 包版本不符时报 003，不能顺手覆盖', async () => {
  const c = await context();
  fs.mkdirSync(path.dirname(manifest(c.unity, 'com.lumiogames.lgui')), {recursive: true});
  fs.writeFileSync(manifest(c.unity, 'com.lumiogames.lgui'), JSON.stringify({name: 'com.lumiogames.lgui', version: '0.0.1'}));
  const before = files(c.unity);
  const result = await exportTo(c);
  assertFailure(result, 'LGUI-CLI-003');
  assert.match(result.json.errors[0].fix, /lgui upgrade/);
  assert.deepEqual(files(c.unity), before);
});

for (const [name, code] of [['com.tencent.puerts.core', 'LGUI-CLI-051'], ['com.tencent.puerts.v8', 'LGUI-CLI-051'], ['com.lumiogames.lgui', 'LGUI-CLI-003']]) {
  test('Unity export：' + name + ' 清单为 JSON null 时有明确错误码，原产物不变', async () => {
    const c = await context();
    const file = manifest(c.unity, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, 'null');
    const before = files(c.unity);
    assertFailure(await exportTo(c), code);
    assert.deepEqual(files(c.unity), before);
  });
}

test('Unity export：第一次装包、精确补丁、场景/link.xml 和全部生成物齐全', async () => {
  const c = await context();
  const result = await exportTo(c);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.data.patch, 'applied');
  assert.equal(hash(patchPath(c.unity)), puertsPatchedHash);
  assert.deepEqual(files(path.join(c.unity, 'Packages/com.lumiogames.lgui')), files(packageSource));
  const guid = /guid: ([a-f0-9]{32})/.exec(read(packageSource, 'Runtime/LGUIBoot.cs.meta'))[1];
  assert.match(read(c.unity, 'Assets/LGUI/LGUIBoot.unity'), new RegExp('m_Script: \\{fileID: 11500000, guid: ' + guid + ', type: 3\\}'));
  assert.equal(read(c.unity, 'Assets/LGUI/link.xml'), read(packageSource, 'Runtime/link.xml'));
  const uiFiles = Object.keys(files(path.join(c.unity, 'Assets/LGUI/Resources/UI')));
  assert.ok(uiFiles.some(file => file.endsWith('_fui.bytes')));
  for (const file of uiFiles.filter(file => file.endsWith('_fui.bytes'))) {
    assert.equal(fs.readFileSync(path.join(c.unity, 'Assets/LGUI/Resources/UI', file)).subarray(0, 4).toString(), 'FGUI');
  }
  assert.ok(uiFiles.includes('i18n/zh-CN.xml'));
  assert.ok(uiFiles.includes('i18n/en.xml'));
  for (const dir of ['UI', 'Game']) assert.match(read(c.unity, 'Assets/LGUI/Resources/' + dir + '/README.txt'), /这里是生成物，不要在 Unity 里改/);
  const code = read(c.unity, 'Assets/LGUI/Resources/Game/game.js.txt');
  const globals = {};
  vm.runInNewContext(code, globals);
  assert.equal(typeof globals.__lguiStart, 'function');
  const startupErrors = [];
  globals.CS = {LGUI: {Platform: {Log: (level, message) => startupErrors.push({level, message})}}};
  await globals.__lguiStart();
  assert.equal(startupErrors[0].level, 'error');
  assert.match(startupErrors[0].message, /LGUI-RT-001/);
  assert.notEqual(globals.__lguiReady, true, '异步启动失败不能被当作 Ready');
  assert.doesNotMatch(code, /import\s.*from\s/);
  assert.doesNotMatch(code, /document\.|window\.|process\.|require\(/);
  const config = JSON.parse(read(c.root, '.lgui/project.json'));
  assert.equal(path.resolve(c.root, config.unityProject), c.unity);
});

test('Unity export：已补明确跳过，再导出更新生成物且保留启动场景', async () => {
  const c = await context({patched: true});
  const first = await exportTo(c);
  assert.equal(first.code, 0, first.stdout);
  assert.equal(first.json.data.patch, 'already-applied');
  const cpp = fs.readFileSync(patchPath(c.unity));
  fs.writeFileSync(path.join(c.unity, 'Assets/LGUI/LGUIBoot.unity'), 'user scene\n');
  fs.writeFileSync(path.join(c.unity, 'Assets/LGUI/Resources/UI/stale.bytes'), 'stale');
  fs.writeFileSync(path.join(c.unity, 'Assets/LGUI/Resources/Game/stale.txt'), 'stale');
  fs.writeFileSync(path.join(c.unity, 'Assets/UserCode.cs'), '// owner code');
  const title = path.join(c.root, 'ui/assets/Main/MainView.xml');
  const oldBytes = hash(path.join(c.unity, 'Assets/LGUI/Resources/UI/Main_fui.bytes'));
  fs.writeFileSync(title, fs.readFileSync(title, 'utf8').replace('你好，LGUI', 'TITLE-CHANGED'));
  const second = await exportTo(c);
  assert.equal(second.code, 0, second.stdout);
  assert.equal(second.json.data.patch, 'already-applied');
  assert.deepEqual(fs.readFileSync(patchPath(c.unity)), cpp);
  assert.equal(read(c.unity, 'Assets/LGUI/LGUIBoot.unity'), 'user scene\n');
  assert.equal(read(c.unity, 'Assets/UserCode.cs'), '// owner code');
  assert.equal(fs.existsSync(path.join(c.unity, 'Assets/LGUI/Resources/UI/stale.bytes')), false);
  assert.equal(fs.existsSync(path.join(c.unity, 'Assets/LGUI/Resources/Game/stale.txt')), false);
  assert.notEqual(hash(path.join(c.unity, 'Assets/LGUI/Resources/UI/Main_fui.bytes')), oldBytes);
});

test('Unity export：LGUI 与 Unity 共用根目录时记录有效路径，后续命令仍能读工程', async () => {
  const c = await context();
  createUnityProject(c.root);
  const exported = await exportTo({...c, unity: c.root});
  assert.equal(exported.code, 0, exported.stdout);
  assert.equal(JSON.parse(read(c.root, '.lgui/project.json')).unityProject, '.');
  const listed = await run(['ui', 'list', '--json'], path.join(c.root, 'src'));
  assert.equal(listed.code, 0, listed.stdout);
});

test('Unity export：打包失败保留原 Unity 产物、PuerTS 与 project.json', async () => {
  const c = await context();
  fs.mkdirSync(path.join(c.unity, 'Assets/LGUI/Resources/Game'), {recursive: true});
  fs.writeFileSync(path.join(c.unity, 'Assets/LGUI/Resources/Game/game.js.txt'), 'old script');
  fs.writeFileSync(path.join(c.root, 'src/main.ts'), 'export default (;');
  const before = files(c.unity), config = read(c.root, '.lgui/project.json');
  assertFailure(await exportTo(c), 'LGUI-CLI-032');
  assert.deepEqual(files(c.unity), before);
  assert.equal(read(c.root, '.lgui/project.json'), config);
});

test('Unity export：拒绝生成物目录链接逃逸工程，外部目录不被删除', async () => {
  const c = await context();
  const external = path.join(c.parent, 'owner-files');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'keep.txt'), 'keep');
  fs.mkdirSync(path.join(c.unity, 'Assets/LGUI/Resources'), {recursive: true});
  fs.symlinkSync(external, path.join(c.unity, 'Assets/LGUI/Resources/UI'), 'junction');
  assertFailure(await exportTo(c), 'LGUI-CLI-052');
  assert.equal(read(external, 'keep.txt'), 'keep');
  assert.equal(hash(patchPath(c.unity)), puertsOriginalHash);
});

for (const [target, kind] of [['Assets/LGUI/link.xml', 'directory'], ['Assets/LGUI/LGUIBoot.unity', 'directory'], ['Assets/LGUI/Resources/UI', 'file'], ['Assets/LGUI/Resources', 'file']]) {
  test('Unity export：预检目标类型 ' + target + '，失败前不写补丁或任何产物', async () => {
    const c = await context();
    const targetPath = path.join(c.unity, target);
    fs.mkdirSync(path.dirname(targetPath), {recursive: true});
    if (kind === 'directory') fs.mkdirSync(targetPath);
    else fs.writeFileSync(targetPath, 'owner file');
    const before = files(c.unity), config = read(c.root, '.lgui/project.json');
    assertFailure(await exportTo(c), 'LGUI-CLI-052');
    assert.deepEqual(files(c.unity), before);
    assert.equal(read(c.root, '.lgui/project.json'), config);
  });
}

test('Unity export：管理路径链接即使指向工程内其他 Assets 也不能覆盖用户文件', async () => {
  const c = await context();
  const owner = path.join(c.unity, 'Assets/OwnerAssets');
  fs.mkdirSync(path.join(owner, 'Resources/UI'), {recursive: true});
  fs.writeFileSync(path.join(owner, 'Resources/UI/keep.txt'), 'owner source');
  fs.symlinkSync(owner, path.join(c.unity, 'Assets/LGUI'), 'junction');
  const config = read(c.root, '.lgui/project.json');
  assertFailure(await exportTo(c), 'LGUI-CLI-052');
  assert.equal(read(owner, 'Resources/UI/keep.txt'), 'owner source');
  assert.equal(hash(patchPath(c.unity)), puertsOriginalHash);
  assert.equal(read(c.root, '.lgui/project.json'), config);
});

test('Unity export：工程用了代码图标（icons / registerIcons / icon://）时明确报 LGUI-CLI-144，不改写 Unity 工程或 project.json', async () => {
  for (const mutate of [
    root => {
      const main = path.join(root, 'src/main.ts');
      fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace("backend: 'h5',", "backend: 'h5',\n  icons: { play: { shapes: [{ type: 'circle', cx: 16, cy: 16, r: 10, fill: '#fff' }] } },"));
    },
    root => {
      for (const rel of ['ui/assets/Main/MainView.xml', 'ui/assets/Main/MainView@portrait.xml']) {
        const xmlFile = path.join(root, rel);
        fs.writeFileSync(xmlFile, fs.readFileSync(xmlFile, 'utf8').replace('</displayList>', '  <loader id="n9" name="ico" xy="0,0" size="48,48" url="icon://play"/>\n  </displayList>'));
      }
    }
  ]) {
    const c = await context();
    mutate(c.root);
    const before = files(c.unity);
    const config = read(c.root, '.lgui/project.json');
    const result = await exportTo(c);
    assertFailure(result, 'LGUI-CLI-144');
    assert.deepEqual(files(c.unity), before);
    assert.equal(read(c.root, '.lgui/project.json'), config);
  }
});

test('Unity export：lgui init --code-only 无图工程（未用代码图标）可正常导出 .bytes，且不生成图集 PNG', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-export-code-only-'));
  const init = await run(['init', 'game', '--code-only'], parent);
  assert.equal(init.code, 0, init.stderr);
  const c = {parent, root: path.join(parent, 'game'), unity: createUnityProject(path.join(parent, 'UnityProject'))};
  const result = await exportTo(c);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.json.ok, true);
  const uiFiles = fs.readdirSync(path.join(c.unity, 'Assets/LGUI/Resources/UI'));
  assert.ok(uiFiles.includes('Common_fui.bytes'), uiFiles.join(', '));
  assert.ok(uiFiles.includes('Main_fui.bytes'), uiFiles.join(', '));
  assert.equal(uiFiles.some(name => name.endsWith('.png')), false, uiFiles.join(', '));
});

test('Unity export：使用 synth:// 合成声音并配置自定义 platform.audio 的工程正常导出，并把按钮的 synth:// 地址打进脚本', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-export-synth-'));
  const init = await run(['init', 'game', '--code-only'], parent);
  assert.equal(init.code, 0, init.stderr);
  const root = path.join(parent, 'game');
  for (const rel of ['ui/assets/Main/MainView.xml', 'ui/assets/Main/MainView@portrait.xml']) {
    const file = path.join(root, rel);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<Button title="点我"/>', '<Button title="点我" sound="synth://laser"/>'));
  }
  const main = path.join(root, 'src/main.ts');
  fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace(
    "backend: 'h5',",
    "backend: 'h5',\n  platform: { audio: { play() {}, music() {}, setPaused() {} } },"
  ));
  const check = await run(['check'], root);
  assert.equal(check.code, 0, check.stdout + check.stderr);
  const c = {parent, root, unity: createUnityProject(path.join(parent, 'UnityProject'))};
  const result = await exportTo(c);
  assert.equal(result.code, 0, result.stdout);
  const bundle = fs.readFileSync(path.join(c.unity, 'Assets/LGUI/Resources/Game/game.js.txt'), 'utf8');
  assert.match(bundle, /Main\/MainView#button/);
  assert.match(bundle, /synth:\/\/laser/);
});

test('Unity export：存在网页宿主 host/main.ts 时明确跳过 host/ 并在摘要中提示，不把它打进 game.js.txt', async () => {
  const c = await context();
  fs.mkdirSync(path.join(c.root, 'host'), {recursive: true});
  fs.writeFileSync(path.join(c.root, 'host/main.ts'), "import { defineWebHost } from 'lgui/host';\nexport default defineWebHost({ mount(stage) { const marker = '__WEB_HOST_ONLY__'; void stage; void marker; } });\n");
  const result = await exportTo(c);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.json.data.webHostSkipped, true);
  const plain = await run(['unity', 'export', '--to', c.unity], c.root);
  assert.equal(plain.code, 0, plain.stdout + plain.stderr);
  assert.match(plain.stdout, /跳过 host\//);
  const bundle = fs.readFileSync(path.join(c.unity, 'Assets/LGUI/Resources/Game/game.js.txt'), 'utf8');
  assert.doesNotMatch(bundle, /__WEB_HOST_ONLY__/);
});
