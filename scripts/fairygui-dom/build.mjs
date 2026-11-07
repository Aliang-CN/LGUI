// 生成浏览器端用的 FairyGUI-dom：上游原文件（upstream/，按 VERSION.md 的提交取，一个字节不改）按顺序打上
// plugin/framework/backends/h5/fairygui-patches/*.patch，写到 plugin/framework/backends/h5/vendor/fairygui.module.js。
// 生成文件不手改：要改就改 .patch（或 fairygui-patches/ 里的钩子），再运行本脚本。
//
// 用法：
//   node scripts/fairygui-dom/build.mjs           校验上游原文件、打补丁、写生成文件
//   node scripts/fairygui-dom/build.mjs --check   只比较，生成文件和「上游 + 补丁」不一致时退出码 1（npm run check 会调用）
//   node scripts/fairygui-dom/build.mjs --fetch   升级上游时用：按 VERSION.md 的提交重新下载上游原文件，再生成
//
// 补丁按 git diff / diff -u 的格式写，按文件名顺序一个接一个打（后一个在前一个打完的结果上做）。
// 每一段都要在原位置逐行对上，对不上就停下报错，不做模糊匹配：上游改了，就要人来重看那个补丁。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const h5 = path.join(root, 'plugin/framework/backends/h5');
const versionFile = path.join(h5, 'vendor/VERSION.md');
const patchDir = path.join(h5, 'fairygui-patches');
const upstreamFile = path.join(root, 'scripts/fairygui-dom/upstream/fairygui.module.js');
const outputFile = path.join(h5, 'vendor/fairygui.module.js');
const rel = file => path.relative(root, file).split(path.sep).join('/');

/** VERSION.md 里的上游提交和上游原文件的 SHA-256。 */
export function upstreamVersion() {
  const text = fs.readFileSync(versionFile, 'utf8');
  const commit = /提交：`([0-9a-f]{40})`/.exec(text)?.[1];
  const sha256 = /SHA-256：`([0-9a-f]{64})`/.exec(text)?.[1];
  if (!commit || !sha256) throw new Error(`${rel(versionFile)} 里要写「提交：\`<40 位提交号>\`」和「SHA-256：\`<64 位>\`」。`);
  return {commit, sha256};
}

const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

/** 打一个补丁。text、patch 都按 \n 分行（\r 留在行里，上游有几行是 CRLF）。 */
export function applyPatch(text, patch, name) {
  const lines = text.split('\n');
  const rows = patch.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  const out = [];
  let pos = 0; // lines 里已经处理到哪一行（下标）
  let hunk = 0;
  let i = rows.findIndex(row => row.startsWith('@@'));
  if (i < 0) throw new Error(`${name}：没有补丁段（@@ … @@）。`);
  while (i < rows.length) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rows[i]);
    if (!head) throw new Error(`${name} 第 ${i + 1} 行：应该是补丁段开头（@@ -a,b +c,d @@），实际是「${rows[i]}」。`);
    hunk++;
    const oldCount = head[2] === undefined ? 1 : Number(head[2]);
    const start = oldCount === 0 ? Number(head[1]) : Number(head[1]) - 1;
    const before = [], after = [];
    for (i++; i < rows.length && !rows[i].startsWith('@@'); i++) {
      const row = rows[i];
      if (row.startsWith(' ')) { before.push(row.slice(1)); after.push(row.slice(1)); }
      else if (row.startsWith('-')) before.push(row.slice(1));
      else if (row.startsWith('+')) after.push(row.slice(1));
      else if (!row.startsWith('\\')) throw new Error(`${name} 第 ${i + 1} 行：补丁行要以空格、-、+ 开头，实际是「${row}」。`);
    }
    if (before.length !== oldCount) throw new Error(`${name} 第 ${hunk} 段：段头写了 ${oldCount} 行原文，实际有 ${before.length} 行。`);
    if (start < pos) throw new Error(`${name} 第 ${hunk} 段：和上一段重叠了。`);
    for (let k = 0; k < before.length; k++) {
      if (lines[start + k] !== before[k]) {
        throw new Error(`${name} 第 ${hunk} 段对不上：上游第 ${start + k + 1} 行应该是「${before[k].trim()}」，实际是「${(lines[start + k] ?? '（文件结束）').trim()}」。上游在这里改过，按 vendor/PATCHES.md 重看这个补丁，在新的上游原文件上重新做。`);
      }
    }
    out.push(...lines.slice(pos, start), ...after);
    pos = start + before.length;
  }
  out.push(...lines.slice(pos));
  return out.join('\n');
}

/** fairygui-patches/ 里的 .patch，按文件名排序。 */
export function patchFiles() {
  return fs.readdirSync(patchDir).filter(name => name.endsWith('.patch')).sort().map(name => path.join(patchDir, name));
}

/** 上游原文件打完全部补丁后的内容。 */
export function build() {
  const {commit, sha256} = upstreamVersion();
  const upstream = fs.readFileSync(upstreamFile);
  const actual = sha(upstream);
  if (actual !== sha256) throw new Error(`${rel(upstreamFile)} 的 SHA-256 是 ${actual}，VERSION.md 写的是 ${sha256}：上游原文件不能改。升级上游时先改 VERSION.md 的提交，运行 --fetch，再把新的 SHA-256 写进 VERSION.md。`);
  let text = upstream.toString('utf8');
  for (const file of patchFiles()) text = applyPatch(text, fs.readFileSync(file, 'utf8'), rel(file));
  const header = `// 生成文件，不要手改：FairyGUI-dom ${commit} 的 dist/fairygui.module.js 按顺序打上 fairygui-patches/*.patch（scripts/fairygui-dom/build.mjs）。补丁台账见同目录 PATCHES.md。\n`;
  return header + text;
}

/** 生成文件和「上游 + 补丁」不一致时返回它的路径（给 scripts/check.mjs 用）。 */
export function staleFairyGui() {
  const current = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
  return current === build() ? [] : [rel(outputFile)];
}

async function fetchUpstream() {
  const {commit} = upstreamVersion();
  const url = `https://raw.githubusercontent.com/fairygui/FairyGUI-dom/${commit}/dist/fairygui.module.js`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载 ${url} 失败（HTTP ${response.status}）。`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(upstreamFile, buffer);
  console.log(`已下载 ${url}\nSHA-256：${sha(buffer)}（和 VERSION.md 不一样时改 VERSION.md）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--fetch')) await fetchUpstream();
    if (args.includes('--check')) {
      const stale = staleFairyGui();
      if (stale.length) { console.error(`${stale[0]} 和「上游 + fairygui-patches/*.patch」不一致  → 运行 node scripts/fairygui-dom/build.mjs`); process.exit(1); }
      console.log(`${rel(outputFile)} 和上游 + ${patchFiles().length} 个补丁一致。`);
    } else {
      fs.writeFileSync(outputFile, build());
      console.log(`已生成 ${rel(outputFile)}（上游 + ${patchFiles().map(f => path.basename(f)).join('、')}）。`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
