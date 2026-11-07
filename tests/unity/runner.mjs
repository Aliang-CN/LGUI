// 开发用 Unity 一致性运行器。与 headless/h5 复用 cases/、harness.ts 与框架启动流程。
// 不随 plugin/ 下发，不把 Node 的模拟后端或测试命令口放进正式 Unity 包。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';
import {generateUnity, uiProjectPath} from '../../plugin/tools/lib/generate/index.mjs';
import {readUiModel} from '../../plugin/tools/lib/generate/model.mjs';
import {generateTranslations} from '../../plugin/tools/lib/generate/i18n.mjs';
import {runtimeConfig, webBuildOptions} from '../../plugin/tools/lib/dev/bundle.mjs';
import {conformanceProject, runHeadless, runH5} from '../conformance/runner.mjs';
import {launchBrowser} from '../helpers/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const codePath = file => JSON.stringify(file.split(path.sep).join('/'));

/** 把同一份用例打包到一个已选定的开发 Unity 工程中；不会启动 Unity。 */
export async function prepareConformanceCase(context, name, unityProject) {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !fs.existsSync(path.join(context.root, 'conformance/cases', `${name}.ts`))) {
    throw new Error(`LGUI-RT-001 未知的一致性用例 ${name}。`);
  }
  const fw = rel => codePath(path.join(context.root, '.lgui/framework', rel));
  const ui = path.join(unityProject, 'Assets/LGUI/Resources/UI');
  const bundle = path.join(unityProject, 'Assets/LGUI/Resources/Game/game.js.txt');
  await generateUnity(uiProjectPath(context.root), ui);
  generateTranslations(context.root, readUiModel(uiProjectPath(context.root)), context.project.languages, path.join(ui, 'i18n'), context.project.defaultLanguage);
  const entry = path.join(context.root, '.lgui/build', `unity-conformance-${name}.ts`);
  fs.mkdirSync(path.dirname(entry), {recursive: true});
  fs.writeFileSync(entry, `// 由 tests/unity/runner.mjs 生成，仅用于原生一致性验证。
import {lgui} from 'lgui';
import app from ${codePath(path.join(context.root, 'src/main.ts'))};
import c from ${codePath(path.join(context.root, 'conformance/cases', `${name}.ts`))};
import layout from ${codePath(path.join(context.root, 'conformance/layout.ts'))};
import {capture} from ${codePath(path.join(context.root, 'conformance/harness.ts'))};
import {createUnityBackend} from ${fw('backends/unity/adapter/index.ts')};
import {format} from ${fw('mvc/i18n.ts')};
type Point = {x: number; y: number};
type Native = {width: number; height: number; LocalToGlobal(point: Point): Point};
declare const CS: {
  UnityEngine: {Vector2: new (x: number,y: number) => Point};
  LGUI: {Tests: {ConformanceBridge: {
    readonly RenderedFrame: number;
    readonly ConsumedPointerDown: number; readonly ConsumedPointerUp: number;
    Complete(json: string): void; Pointer(x: number,y: number,down: boolean,touch: boolean): number;
    Key(key: string): void; TypeText(text: string): void; Wheel(x: number,y: number,dx: number,dy: number): void;
    SetScreen(width: number,height: number): void; SizeMatches(width: number,height: number): boolean;
  }}};
};
const native = CS.LGUI.Tests.ConformanceBridge;
let backend: ReturnType<typeof createUnityBackend>;
const wait = (ms: number) => new Promise<void>(resolve => {
  const end = backend.platform.time.now() + ms;
  const off = backend.platform.time.onFrame(() => { if (backend.platform.time.now() >= end) { off(); resolve(); } });
});
// app.start/open 在原生布局与第一次渲染之前就能完成。等真实 Stage.afterUpdate，
// 避免首次字体/着色器准备把一次 50ms 的测试点击拉长成超过 tapMs 的真实长按。
const rendered = async () => {
  const previous=native.RenderedFrame;
  const deadline=backend.platform.time.now()+10000;
  while(native.RenderedFrame<=previous) {
    if(backend.platform.time.now()>deadline)throw new Error('LGUI-RT-001 Unity Stage 未完成原生布局与渲染更新。');
    await wait(0);
  }
};
const consumed = async (sequence: number,down: boolean) => {
  const deadline=backend.platform.time.now()+10000;
  while((down?native.ConsumedPointerDown:native.ConsumedPointerUp)<sequence) {
    if(backend.platform.time.now()>deadline)throw new Error('LGUI-RT-001 Unity Stage 未消费对应的测试指针事件。');
    await wait(0);
  }
};
const center = (object: unknown): Point => {
  const n = (object as {native: Native}).native;
  return n.LocalToGlobal(new CS.UnityEngine.Vector2(n.width/2,n.height/2));
};
const press = async (object: unknown,ms: number,touch = false) => {
  await rendered();
  const p = center(object);
  await consumed(native.Pointer(p.x,p.y,true,touch),true);
  await wait(ms);
  await consumed(native.Pointer(p.x,p.y,false,touch),false);
  await wait(50);
};
const move = async (object: unknown,dx: number,dy: number,ms: number,steps: number) => {
  await rendered();
  const p = center(object);
  const scale = backend.platform.screen.size().width / backend.root.rect.width;
  await consumed(native.Pointer(p.x,p.y,true,true),true); await wait(20);
  for (let i=1;i<=steps;i++) { await wait(ms/steps); native.Pointer(p.x+dx*scale*i/steps,p.y+dy*scale*i/steps,true,true); }
  await consumed(native.Pointer(p.x+dx*scale,p.y+dy*scale,false,true),false); await wait(50);
};
const sim = {
  click: (_b: unknown,o: unknown,ms=50,pointerType='mouse') => press(o,ms,pointerType==='touch'),
  async doubleClick(b: unknown,o: unknown) { await sim.click(b,o); await sim.click(b,o); },
  hold: (_b: unknown,o: unknown,ms: number) => press(o,ms),
  drag: (_b: unknown,o: unknown,dx: number,dy: number) => move(o,dx,dy,400,10),
  swipe: (_b: unknown,o: unknown,dx: number,dy: number) => move(o,dx,dy,80,4),
  async pinch() { throw new Error('LGUI-RT-001 Unity 开发运行器尚未接双指缩放输入。'); },
  // 拖放：按住来源，先挪 20 像素（超过拖动门槛），再在 400 毫秒里分 10 步挪到目标中心松手（和 headless、h5 一样）。
  async dragTo(_b: unknown,from: unknown,to: unknown) {
    await rendered();
    const a=center(from), z=center(to);
    await consumed(native.Pointer(a.x,a.y,true,true),true);
    await wait(40); native.Pointer(a.x+20,a.y,true,true);
    for (let i=2;i<=10;i++) { await wait(40); const k=(i-1)/9; native.Pointer(a.x+20+(z.x-a.x-20)*k,a.y+(z.y-a.y)*k,true,true); }
    await consumed(native.Pointer(z.x,z.y,false,true),false); await wait(50);
  },
  async type(b: unknown,o: unknown,text: string) {
    await sim.click(b,o);
    const input=(o as {native: {text: string; SetSelection(start: number,length: number): void}}).native;
    input.SetSelection(0,input.text.length);
    if(text)native.TypeText(text);else native.Key('Backspace');
    await wait(50);
  },
  // 拖滑动条：按住滑块（子控件 grip），一次挪到目标值对应的位置再松开。
  async setValue(_b: unknown,o: unknown,value: number) {
    await rendered();
    // bar 的宽度跟着值变；一致性用例的滑动条 bar 铺满整个滑动条，所以按滑动条的宽度换算。
    const s=o as {min: number; max: number; value: number; native: Native & {GetChild(name: string): Native | null}};
    const grip=s.native.GetChild('grip');
    if(!grip)throw new Error('LGUI-RT-001 Unity 开发运行器只认带 grip 子控件的横向滑动条。');
    const from=center({native: grip});
    const scale=backend.platform.screen.size().width/backend.root.rect.width;
    const target=(Math.min(s.max,Math.max(s.min,value))-s.min)/(s.max-s.min);
    const dx=(target-(s.value-s.min)/(s.max-s.min))*s.native.width*scale;
    await consumed(native.Pointer(from.x,from.y,true,false),true); await wait(20);
    native.Pointer(from.x+dx,from.y,true,false); await wait(20);
    await consumed(native.Pointer(from.x+dx,from.y,false,false),false); await wait(50);
  },
  // 选下拉框：点开，再点弹出列表（dropdown 里名为 list 的列表）里的那一项。
  async choose(b: unknown,o: unknown,index: number) {
    await sim.click(b,o);
    await rendered();
    const item=(o as {native: {dropdown: {GetChild(name: string): {GetChildAt(i: number): Native}}}}).native.dropdown.GetChild('list').GetChildAt(index);
    await sim.click(b,{native: item});
  },
  async setSafeArea(_b: unknown,insets: {top: number; right: number; bottom: number; left: number}) {
    (globalThis as {__lguiSafeArea?: unknown}).__lguiSafeArea={...insets};
    await rendered(); await rendered();
  },
  async wheel(_b: unknown,o: unknown,dy: number) { await rendered();const p=center(o);native.Wheel(p.x,p.y,0,dy);await wait(50); },
  async key(_b: unknown,key: string) { await rendered();native.Key(key);await wait(50); },
  async setScreen(_b: unknown,width: number,height: number) {
    native.SetScreen(width,height);
    const deadline=backend.platform.time.now()+10000;
    while(!native.SizeMatches(width,height)) {
      if(backend.platform.time.now()>deadline)throw new Error('LGUI-RT-001 Unity 测试窗口没有变成要求的尺寸。');
      await wait(20);
    }
    await wait(50);
  },
  advance: (_b: unknown,ms: number) => wait(ms)
};
const config=${JSON.stringify(runtimeConfig(context.project))};
const deps=${JSON.stringify(context.deps)};
const texts=${JSON.stringify(context.texts)};
(globalThis as unknown as {__lguiTest: unknown}).__lguiTest={
  createBackend() {
    backend=createUnityBackend();
    const init=backend.init.bind(backend);
    backend.init=options=>init({...options,uiBase:'UI',i18nBase:'UI/i18n'});
    return backend;
  },sim,config,deps,texts,current:null
};
(globalThis as unknown as {__lguiStart:()=>Promise<void>}).__lguiStart=async()=>{
  try {
    const t=await lgui.testing.start(app);
    const result=capture(t,layout,await c.run(t));
    const formatted={number:format.number(12345),currency:format.currency(123.5,'USD')};
    t.end();
    native.Complete(JSON.stringify({ok:true,name:${JSON.stringify(name)},result,intl:typeof Intl,formatted}));
  }catch(error){native.Complete(JSON.stringify({ok:false,name:${JSON.stringify(name)},error:String(error)}));}
};
`);
  await esbuild().build({...webBuildOptions(context.root, entry, {dev: false, outfile: bundle}), format: 'iife', platform: 'neutral', sourcemap: false});
  fs.writeFileSync(path.join(ui, 'README.txt'), '这里是生成物，不要在 Unity 里改。\n');
  fs.writeFileSync(path.join(path.dirname(bundle), 'README.txt'), '这里是生成物，不要在 Unity 里改。\n');
  return {bundle, ui, entry};
}

/** 用已安装的官方本地包建开发工程，不下载安装 Unity 或 PuerTS。 */
export function prepareUnityProject(project, {unityPackage, puertsCore, puertsV8}) {
  const packages = [['com.lumiogames.lgui', unityPackage, null], ['com.tencent.puerts.core', puertsCore, '3.0.3'], ['com.tencent.puerts.v8', puertsV8, '3.0.3']];
  for (const [name, source, version] of packages) {
    if (!source) throw new Error(`LGUI-RT-001 缺少本地 Unity 包 ${name} 的路径。`);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    if (manifest.name !== name || (version && manifest.version !== version)) throw new Error(`LGUI-RT-001 Unity 包 ${name} 的名称或版本不符。`);
  }
  fs.mkdirSync(path.join(project, 'Packages'), {recursive: true});
  fs.mkdirSync(path.join(project, 'ProjectSettings'), {recursive: true});
  fs.cpSync(path.join(here, 'Assets'), path.join(project, 'Assets'), {recursive: true});
  fs.cpSync(path.join(here, 'UserSettings'), path.join(project, 'UserSettings'), {recursive: true});
  const dependencies = {'com.unity.ugui': '2.0.0'};
  for (const module of ['animation','assetbundle','audio','imageconversion','imgui','jsonserialize','particlesystem','physics','physics2d','screencapture','terrain','terrainphysics','ui','uielements','unitywebrequest','unitywebrequestaudio','unitywebrequesttexture','video']) dependencies[`com.unity.modules.${module}`] = '1.0.0';
  for (const [name, source] of packages) {
    const target = path.join(project, 'Packages', name);
    if (fs.existsSync(target)) throw new Error(`LGUI-RT-001 测试工程已含 ${target}，请选新的测试工程目录。`);
    fs.cpSync(source, target, {recursive: true});
    dependencies[name] = `file:${name}`;
  }
  fs.writeFileSync(path.join(project, 'Packages/manifest.json'), JSON.stringify({dependencies}, null, 2) + '\n');
  fs.writeFileSync(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.6.6f1\n');
}

/** 实际启动 Editor Play，等待同一份用例完成；编译成功不会被当作运行成功。 */
export async function runUnityConformance({editor, project, result, log, timeout = 180, screen = {width: 1280, height: 720}, trace = false}) {
  fs.mkdirSync(path.dirname(result), {recursive: true});
  fs.mkdirSync(path.dirname(log), {recursive: true});
  if (fs.existsSync(result)) throw new Error(`LGUI-RT-001 验收结果文件已存在：${result}。请使用新路径，避免读到旧结果。`);
  const args = ['-batchmode', '-projectPath', project, '-executeMethod', 'LGUI.Tests.LGUIConformanceEditor.Run', '-logFile', log,
    '-lguiResult', result, '-lguiTimeout', String(timeout), '-lguiWidth', String(screen.width), '-lguiHeight', String(screen.height)];
  if (trace) args.push('-lguiTrace');
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(editor, args, {windowsHide: true, stdio: 'ignore'});
    child.on('error', reject);
    child.on('exit', code => resolve(code));
  });
  if (exitCode !== 0) throw new Error(`LGUI-RT-001 Unity 开发运行器退出 ${exitCode}；查看 ${log}。`);
  const output = JSON.parse(fs.readFileSync(result, 'utf8'));
  if (!output.ok) throw new Error(`LGUI-RT-001 Unity 一致性用例失败：${output.error}`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
  const required = ['editor', 'project', 'package', 'puerts-core', 'puerts-v8', 'evidence'];
  for (const name of required) if (!flags[name]) throw new Error(`LGUI-RT-001 缺少 --${name}。`);
  const context = await conformanceProject();
  const project = path.resolve(flags.project);
  prepareUnityProject(project, {unityPackage: path.resolve(flags.package), puertsCore: path.resolve(flags['puerts-core']), puertsV8: path.resolve(flags['puerts-v8'])});
  const name = flags.case ?? 'binding-language';
  await prepareConformanceCase(context, name, project);
  const evidence = path.resolve(flags.evidence);
  const output = await runUnityConformance({editor: path.resolve(flags.editor), project, result: path.join(evidence, `${name}.json`), log: path.join(evidence, `${name}.log`)});
  const headless = await runHeadless(context, name);
  const browser = await launchBrowser();
  if (!browser) throw new Error('LGUI-RT-001 缺少 Chrome 或 Edge，无法完成三后端快照比较。');
  let h5;
  try { h5 = await runH5(context, name, browser); } finally { await browser.close(); }
  fs.writeFileSync(path.join(evidence, `${name}.headless.json`), JSON.stringify(headless, null, 2) + '\n');
  fs.writeFileSync(path.join(evidence, `${name}.h5.json`), JSON.stringify(h5, null, 2) + '\n');
  assert.deepEqual(output.result, headless, 'Unity 与 headless 的完整快照必须一致');
  assert.deepEqual(output.result, h5, 'Unity 与 h5 的完整快照必须一致');
  console.log(JSON.stringify({project, evidence, comparison: 'unity=headless=h5', ...output}, null, 2));
}
