// 编辑器版本兼容实测（S2-I3）：编辑器（OpenFairyGUI 0.2.4）打开并保存一个 FairyGUI 工程 → 用随插件带的 0.7.0 生成网页界面包 → 浏览器能加载。
// 用法：node scripts/build-editor/check-compat.mjs [工程目录 ...]。不写时测三个：lgui init 的模板工程、背包示例 examples/inventory/ui、
// 跨包图片（模板工程的 MainView 横竖两版各加一张 Common 包的图片 <image pkg="cmn00001" src="placehd1">，改的就是这个组件，保存后 pkg 还在）。
// 每个工程：复制到临时目录 → lgui editor 的服务打开它 → 把一个文字控件右移 1 像素并保存（不改文字，免得牵动文本表） → 导出工作区 ZIP → 和原文件比较 → 0.7.0 生成 → 浏览器里加载每个包、创建每个导出的组件。
// 模板工程再多一步：把保存后的文件放回工程，跑 lgui check 和 lgui verify --size desktop。需要 Chrome 或 Edge。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {main as cli} from '../../plugin/tools/lib/cli.mjs';
import {editorDir} from '../../plugin/tools/lib/paths.mjs';
import {startEditorServer} from '../../plugin/tools/lib/editor/relay.mjs';
import {esbuild, playwright} from '../../plugin/tools/lib/vendor.mjs';
import {generateWeb} from '../../plugin/tools/lib/generate/index.mjs';
import {readUiModel} from '../../plugin/tools/lib/generate/model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const framework = path.join(root, 'plugin', 'framework');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quiet = {write() {}};
const lgui = (argv, cwd) => cli(argv, {cwd, stdout: quiet, stderr: quiet});
// 跑一条 lgui 命令，返回 ok 或者错误和警告的清单。
async function lguiReport(argv, cwd) {
  const out = [];
  await cli([...argv, '--json'], {cwd, stdout: {write: t => out.push(t)}, stderr: quiet});
  const json = JSON.parse(out.join(''));
  const findings = [...(json.data?.findings ?? []), ...(json.errors ?? [])].map(f => `${f.level === 'warning' ? '警告 ' : ''}${f.code} ${f.file ?? ''}:${f.line ?? ''} ${f.message}`);
  return json.ok && !findings.length ? 'ok' : findings;
}
const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `lgui-compat-${name}-`));
const fairyIn = dir => fs.readdirSync(dir).find(f => f.endsWith('.fairy'));
const walk = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), {withFileTypes: true}).flatMap(e => e.name.startsWith('.') ? [] : e.isDirectory() ? walk(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]);

function unzip(file, out) {
  fs.mkdirSync(out, {recursive: true});
  for (const [cmd, args] of [['tar', ['-xf', file, '-C', out]], ['unzip', ['-q', '-o', file, '-d', out]]]) {
    if (spawnSync(cmd, args).status === 0) return;
  }
  throw new Error('解不开 ZIP（需要 tar 或 unzip）。');
}

// 编辑器打开工程、移动一个文字控件、保存、导出。返回解出来的目录和改了哪个控件。
// edit：要改的组件（包名/组件名），不写就取第一个有文字控件的组件。
async function saveWithEditor(browser, projectDir, edit) {
  const server = await startEditorServer({editorDir, projectDir, connectionFile: path.join(tmp('conn'), 'c.json')});
  const page = await browser.newPage({viewport: {width: 1600, height: 900}});
  try {
    await page.goto(`${server.baseUrl}/?agent=1`);
    await page.waitForFunction(() => window.fairyEditorAgent, null, {timeout: 20000});
    const agent = request => page.evaluate(r => window.fairyEditorAgent.request(r), request);
    // 等编辑器从 ui/ 重新导入完
    const fairy = fairyIn(projectDir);
    let state;
    for (let i = 0; i < 60; i++) {
      state = await agent({method: 'state'});
      if (state.ok && state.data.workspace.fairyPath === fairy && state.data.editor.liveSession) break;
      await sleep(500);
    }
    if (state.data.workspace.fairyPath !== fairy) throw new Error(`编辑器没有导入 ${fairy}：${JSON.stringify(state.data.workspace)}`);
    await sleep(1000);
    state = await agent({method: 'state'});
    const model = readUiModel(path.join(projectDir, fairy));
    const component = model.packages.flatMap(p => p.components).find(c => (!edit || c.fullName === edit) && c.children.some(ch => ch.tag === 'text' && ch.id));
    const text = component.children.find(ch => ch.tag === 'text' && ch.id);
    const selector = {packageId: component.pkg.id, componentResourceId: component.id, displayNodeId: text.id};
    const node = await agent({method: 'query', selector});
    const tx = await agent({method: 'transact', requestId: 'compat-1', identity: node.data.identity, summary: 'compat', operations: [{kind: 'setDisplayNodeProps', selector, props: {position: {...node.data.entity.position, x: node.data.entity.position.x + 1}}}]});
    if (!tx.ok) throw new Error(`修改失败：${JSON.stringify(tx.error)}`);
    const saved = await agent({method: 'save', requestId: 'compat-2', identity: tx.data.identity, selector});
    if (!saved.ok) throw new Error(`保存失败：${JSON.stringify(saved.error)} ${JSON.stringify({checkpointSaved: saved.data?.checkpointSaved, browserWorkspaceSaved: saved.data?.browserWorkspaceSaved, verification: saved.data?.verification, save: saved.data?.save, writeback: saved.data?.writeback})}`);
    const exported = await agent({method: 'export', identity: saved.data.identity});
    if (!exported.ok) throw new Error(`导出失败：${JSON.stringify(exported.error)}`);
    const zip = path.join(tmp('zip'), 'workspace.zip');
    fs.writeFileSync(zip, Buffer.from(exported.data.base64, 'base64'));
    const out = tmp('saved');
    unzip(zip, out);
    // ZIP 里可能多一层目录
    const base = fairyIn(out) ? out : path.join(out, fs.readdirSync(out).find(d => fs.existsSync(path.join(out, d, fairy))));
    return {dir: base, edited: `${component.fullName}.${text.name}`};
  } finally {
    await page.close();
    await server.close();
  }
}

// 浏览器里用 h5 后端加载每个包、创建每个导出的组件。
async function loadInBrowser(browser, webDir, components) {
  const work = tmp('load');
  const entry = path.join(work, 'entry.ts');
  const f = rel => JSON.stringify(path.join(framework, rel));
  fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'compat', defaultFont: null, uiBase: '/ui'});
  const failed: string[] = [];
  const list = ${JSON.stringify(components)} as [string, string][];
  for (const pkg of [...new Set(list.map(c => c[0]))]) { try { await backend.loadPackage(pkg); } catch (e) { failed.push(pkg + ': ' + String(e)); } }
  let created = 0;
  for (const [pkg, name] of list) { try { backend.create(pkg, name).dispose(); created++; } catch (e) { failed.push(pkg + '/' + name + ': ' + String(e)); } }
  Object.assign(window, {result: {created, failed}});
})().catch(e => Object.assign(window, {result: {created: 0, failed: [String(e)]}}));`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(work, 'app.js'), logLevel: 'silent'});
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') { res.writeHead(200, {'content-type': 'text/html'}).end('<!doctype html><body><script type="module" src="/app.js"></script>'); return; }
    const file = url === '/app.js' ? path.join(work, 'app.js') : path.join(webDir, url.replace(/^\/ui\//, ''));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, {'content-type': url.endsWith('.js') ? 'text/javascript' : url.endsWith('.json') ? 'application/json' : 'application/octet-stream'}).end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.result, null, {timeout: 30000});
    return await page.evaluate(() => window.result);
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}

// 跨包图片的用例：模板工程 MainView 横竖两版各加一张 Common 包的图片。
const CROSS_IMAGE = '<image id="n9" name="crossImage" pkg="cmn00001" src="placehd1" xy="20,20" size="64,64"/>';
function addCrossPackageImage(uiDir) {
  for (const file of ['MainView.xml', 'MainView@portrait.xml']) {
    const xml = path.join(uiDir, 'assets', 'Main', file);
    fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace('</displayList>', `  ${CROSS_IMAGE}\n  </displayList>`));
  }
}

async function check(browser, label, original, {isTemplate, crossImage = false}) {
  const copy = path.join(tmp('src'), 'ui');
  fs.cpSync(original, copy, {recursive: true});
  const report = {project: label};
  const saved = await saveWithEditor(browser, copy, crossImage ? 'Main/MainView' : undefined);
  report.edited = saved.edited;
  if (crossImage) {
    // 保存后图片还在、还是 Common 包的那张（编辑器重写 XML 时属性顺序会变，按属性比）
    const kept = ['MainView.xml', 'MainView@portrait.xml'].map(file => {
      const xml = fs.readFileSync(path.join(saved.dir, 'assets', 'Main', file), 'utf8');
      const tag = /<image\b[^>]*name="crossImage"[^>]*>/.exec(xml)?.[0] ?? '';
      return /\bpkg="cmn00001"/.test(tag) && /\bsrc="placehd1"/.test(tag) ? 'ok' : `${file}：${tag || '图片没了'}`;
    });
    report.crossPackageImage = kept.every(k => k === 'ok') ? 'ok' : kept.filter(k => k !== 'ok');
  }
  const before = new Set(walk(original)), after = new Set(walk(saved.dir));
  const same = f => fs.readFileSync(path.join(original, f)).equals(fs.readFileSync(path.join(saved.dir, f)));
  report.files = {
    unchanged: [...before].filter(f => after.has(f) && same(f)).length,
    changed: [...before].filter(f => after.has(f) && !same(f)),
    added: [...after].filter(f => !before.has(f)),
    removed: [...before].filter(f => !after.has(f))
  };
  const web = tmp('web');
  try {
    await generateWeb(path.join(saved.dir, fairyIn(saved.dir)), web);
    report.generate = 'ok';
  } catch (error) {
    report.generate = `失败：${error.message}`;
    return report;
  }
  const model = readUiModel(path.join(saved.dir, fairyIn(saved.dir)));
  const components = model.packages.flatMap(p => p.components.filter(c => c.exported).map(c => [p.name, c.name]));
  report.browser = await loadInBrowser(browser, web, components);
  if (isTemplate) {
    const parent = tmp('proj');
    await lgui(['init', 'g'], parent);
    const project = path.join(parent, 'g');
    for (const f of after) { fs.mkdirSync(path.dirname(path.join(project, 'ui', f)), {recursive: true}); fs.copyFileSync(path.join(saved.dir, f), path.join(project, 'ui', f)); }
    report.lguiCheck = await lguiReport(['check'], project);
    report.lguiVerify = await lguiReport(['verify', '--size', 'desktop'], project);
  }
  return report;
}

const browser = await (async () => {
  for (const channel of ['chrome', 'msedge']) { try { return await playwright().chromium.launch({channel, headless: true}); } catch { /* 下一个 */ } }
  throw new Error('没找到 Chrome 或 Edge。');
})();
try {
  const args = process.argv.slice(2);
  const targets = args.length ? args.map(a => [a, path.resolve(a), false]) : await (async () => {
    const parent = tmp('template');
    await lgui(['init', 'g'], parent);
    const cross = tmp('cross');
    await lgui(['init', 'g'], cross);
    addCrossPackageImage(path.join(cross, 'g', 'ui'));
    return [
      ['lgui init 模板工程', path.join(parent, 'g', 'ui'), true],
      ['examples/inventory/ui', path.join(root, 'examples', 'inventory', 'ui'), false],
      ['跨包图片（模板工程 + Common 的图片）', path.join(cross, 'g', 'ui'), true, true]
    ];
  })();
  for (const [label, dir, isTemplate, crossImage] of targets) console.log(JSON.stringify(await check(browser, label, dir, {isTemplate, crossImage}), null, 2));
} finally {
  await browser.close();
}
