// 发版前校验：发布面 plugin/ 里不能混入开发文件、Markdown 相对链接都能打开、生成文件一致（含 FairyGUI-dom 打补丁的结果），最后打印 plugin/ 大小。
// 用法：node scripts/check.mjs。有任何问题就逐条列出并以退出码 1 结束。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {staleFiles} from './generate.mjs';
import {staleFairyGui} from './fairygui-dom/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(root, 'plugin');
const rel = file => path.relative(root, file).split(path.sep).join('/');
const problems = [];

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (visit(full, entry) === false) continue;
    if (entry.isDirectory()) walk(full, visit);
  }
}

// 1. 发布面里不能有的东西。
// 例外：随插件带的工具（plugin/tools/vendor/）、Unity 包模板（plugin/framework/backends/unity/package/），
// 以及新建工程模板（plugin/templates/project/，它本身就是一个用户工程，带 tests/、package.json、.gitignore）。
const forbiddenDirs = new Set(['tests', '.github', '.claude', 'node_modules']);
const forbiddenFiles = new Set(['.gitignore', 'package.json']);
const isUnder = (file, prefix) => rel(file) === prefix || rel(file).startsWith(prefix + '/');
const exempt = file =>
  isUnder(file, 'plugin/tools/vendor') ||
  isUnder(file, 'plugin/framework/backends/unity/package') ||
  isUnder(file, 'plugin/templates/project');
walk(pluginDir, (full, entry) => {
  if (exempt(full)) return false;
  if (entry.isDirectory() && forbiddenDirs.has(entry.name)) {
    problems.push(`${rel(full)}/  发布面里不能有开发目录 ${entry.name}/  → 移出 plugin/`);
    return false;
  }
  if (entry.isFile() && forbiddenFiles.has(entry.name)) problems.push(`${rel(full)}  发布面里不能有 ${entry.name}  → 移出 plugin/`);
});

// 2. plugin/**/*.md 里的相对链接都要能打开（跳过代码块和行内代码）。
const markdownFiles = [];
walk(pluginDir, (full, entry) => {
  if (entry.isDirectory() && entry.name === 'node_modules') return false;
  if (entry.isFile() && entry.name.endsWith('.md')) markdownFiles.push(full);
});
for (const file of markdownFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const text = line.replace(/`[^`]*`/g, '');
    for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const clean = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!clean) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), clean))) problems.push(`${rel(file)}:${index + 1}  链接打不开：${target}  → 改成存在的相对路径`);
    }
  });
}

// 3. generate.mjs --check。
for (const file of staleFiles()) problems.push(`${file}  和 plugin/plugin.json 不一致  → 运行 npm run generate`);
try {
  for (const file of staleFairyGui()) problems.push(`${file}  和「上游 FairyGUI-dom + fairygui-patches/*.patch」不一致（生成文件不手改）  → 运行 node scripts/fairygui-dom/build.mjs`);
} catch (error) {
  problems.push(`FairyGUI-dom 补丁打不上：${error instanceof Error ? error.message : String(error)}`);
}

// 4. plugin/ 总大小（只记录，不设上限）。
let bytes = 0, count = 0;
walk(pluginDir, (full, entry) => { if (entry.isFile()) { bytes += fs.statSync(full).size; count++; } });

console.log(`plugin/ 大小：${(bytes / 1024 / 1024).toFixed(2)} MB（${bytes} 字节，${count} 个文件）`);
console.log(`检查了 ${markdownFiles.length} 个 Markdown 文件的链接。`);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`校验失败：${problems.length} 个问题。`);
  process.exit(1);
}
console.log('校验通过。');
