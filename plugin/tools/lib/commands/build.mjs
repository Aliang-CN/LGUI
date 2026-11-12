// lgui build：打正式网页静态包（LGUI_DEV = false，默认压缩，放在任意子路径下都能打开），并统计总包体与 LGUI 运行时字节数。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LgCliError} from '../errors.mjs';
import {esbuild} from '../vendor.mjs';
import {buildDir} from '../paths.mjs';
import {generateProjectTypes, generateWeb, uiProjectPath} from '../generate/index.mjs';
import {generateTranslations} from '../generate/i18n.mjs';
import {generateFonts} from '../generate/fonts.mjs';
import {bundleErrors, webBuildOptions, writeWebBootstrap} from '../dev/bundle.mjs';
import {copyFramework} from './init.mjs';

const shellPath = fileURLToPath(new URL('../dev/shell.html', import.meta.url));
const outFix = '用默认的 dist/，或者把 --out 指向工程下的独立输出文件夹（如 --out dist、--out build/web）。';

const escapeHtml = text => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const isSameOrParent = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const overlaps = (a, b) => isSameOrParent(a, b) || isSameOrParent(b, a);

function resolveWithRealAncestor(target) {
  const tail = [];
  let cur = path.resolve(target);
  while (true) {
    const stat = fs.lstatSync(cur, {throwIfNoEntry: false});
    if (stat?.isSymbolicLink()) {
      throw new LgCliError('LGUI-CLI-150', `输出路径经过了符号链接：${cur}（构建会整目录替换输出目录）。`, {fix: '删掉符号链接或改用真实文件夹路径。'});
    }
    if (stat) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  const base = fs.existsSync(cur) ? fs.realpathSync(cur) : cur;
  return path.join(base, ...tail);
}

/** 校验输出目录安全（构建成功后会整目录替换，绝不能指向工程根、上级目录、源码目录或符号链接）。 */
export function assertSafeOutDir(projectRoot, outDir, rawFlag) {
  if (rawFlag !== undefined && String(rawFlag).trim() === '') {
    throw new LgCliError('LGUI-CLI-150', '--out 不能为空。', {fix: outFix});
  }
  if (path.parse(outDir).root === outDir) {
    throw new LgCliError('LGUI-CLI-150', `输出目录不能是文件系统根目录（${outDir}）。`, {fix: outFix});
  }
  const existing = fs.lstatSync(outDir, {throwIfNoEntry: false});
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new LgCliError('LGUI-CLI-150', `输出路径不能是符号链接：${outDir}（构建会整目录替换输出目录）。`, {fix: '删掉符号链接或改用真实文件夹路径。'});
    }
    if (!existing.isDirectory()) {
      throw new LgCliError('LGUI-CLI-150', `输出路径已存在但不是文件夹：${outDir}。`, {fix: outFix});
    }
  }
  const rootReal = fs.realpathSync(projectRoot);
  const outReal = resolveWithRealAncestor(outDir);
  for (const [rootBase, candidate] of [[projectRoot, outDir], [rootReal, outReal]]) {
    if (isSameOrParent(candidate, rootBase)) {
      throw new LgCliError('LGUI-CLI-150', `输出目录（${outDir}）不能是工程根目录或它的上级目录（构建会清空输出目录）。`, {fix: outFix});
    }
    const guarded = [
      ['src', path.join(rootBase, 'src')],
      ['host', path.join(rootBase, 'host')],
      ['ui', path.join(rootBase, 'ui')],
      ['i18n', path.join(rootBase, 'i18n')],
      ['tests', path.join(rootBase, 'tests')],
      ['.git', path.join(rootBase, '.git')],
      ['node_modules', path.join(rootBase, 'node_modules')],
      ['.lgui/framework', path.join(rootBase, '.lgui', 'framework')],
      ['.lgui/project.json', path.join(rootBase, '.lgui', 'project.json')],
      ['.lgui/build/web-build', path.join(rootBase, '.lgui', 'build', 'web-build')],
      ['.lgui/build/web-build-stage', path.join(rootBase, '.lgui', 'build', 'web-build-stage')]
    ];
    for (const [label, target] of guarded) {
      if (overlaps(candidate, target)) {
        throw new LgCliError('LGUI-CLI-150', `输出目录（${outDir}）不能与工程的 ${label} 重叠或包含它（构建会清空输出目录）。`, {fix: outFix});
      }
    }
  }
}

function walkFiles(dir, prefix = '') {
  const list = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) list.push(...walkFiles(full, rel));
    else if (entry.isFile()) list.push({path: rel, ext: path.extname(entry.name).toLowerCase(), bytes: fs.statSync(full).size});
  }
  return list;
}

const fmt = bytes => `${bytes.toLocaleString('en-US')} 字节（${(bytes / 1024).toFixed(1)} KB）`;

export async function build({args, flags, cwd, projectRoot, project}) {
  if (args.length) {
    throw new LgCliError('LGUI-CLI-006', '用法：lgui build [--out 目录] [--no-minify]，不接受额外的位置参数。', {fix: '要指定输出目录写 --out <目录>。'});
  }
  const outDir = flags.out !== undefined ? path.resolve(cwd, flags.out) : path.join(projectRoot, 'dist');
  assertSafeOutDir(projectRoot, outDir, flags.out);

  if (!fs.existsSync(path.join(projectRoot, '.lgui', 'framework', 'index.ts'))) {
    copyFramework(path.join(projectRoot, '.lgui', 'framework'));
  }

  const minify = !flags['no-minify'];
  const bootOut = buildDir(projectRoot, 'web-build');
  const stage = buildDir(projectRoot, 'web-build-stage');
  fs.rmSync(bootOut, {recursive: true, force: true});
  fs.rmSync(stage, {recursive: true, force: true});
  fs.mkdirSync(stage, {recursive: true});

  try {
    const web = await generateWeb(uiProjectPath(projectRoot), path.join(stage, 'ui'));
    const {model} = await generateProjectTypes(projectRoot, {validated: true});
    generateTranslations(projectRoot, model, project.languages, path.join(stage, 'i18n'), project.defaultLanguage, {format: 'json'});
    const fontNamesList = await generateFonts(projectRoot, project, model, path.join(stage, 'ui', 'fonts'), 'woff2');

    const entry = writeWebBootstrap(projectRoot, project, {dir: bootOut, dev: false});
    const stageAppJs = path.join(stage, 'app.js');
    let bundleResult;
    try {
      bundleResult = await esbuild().build({
        ...webBuildOptions(projectRoot, entry, {dev: false, outfile: stageAppJs}),
        sourcemap: false,
        minify,
        metafile: true
      });
    } catch (error) {
      throw bundleErrors(error, projectRoot);
    }

    const appJsBytes = fs.statSync(stageAppJs).size;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(stageAppJs)).digest('hex').slice(0, 12);
    const shell = fs.readFileSync(shellPath, 'utf8');
    const html = shell
      .replace('<html lang="zh-CN">', `<html lang="${escapeHtml(project.defaultLanguage)}">`)
      .replace('<title>LGUI 预览</title>', `<title>${escapeHtml(project.name)}</title>`)
      .replace('src="./app.js"', `src="./app.js?v=${hash}"`);
    fs.writeFileSync(path.join(stage, 'index.html'), html);

    // 全部生成与打包都通过后，再替换正式输出目录。
    fs.rmSync(outDir, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(outDir), {recursive: true});
    fs.cpSync(stage, outDir, {recursive: true});

    // 从 esbuild metafile 统计 .lgui/framework/ 在 app.js 中占的字节数。
    const frameworkDir = fs.realpathSync(path.join(projectRoot, '.lgui', 'framework'));
    const frameworkLex = path.join(projectRoot, '.lgui', 'framework');
    const vendorReal = path.join(frameworkDir, 'backends', 'h5', 'vendor') + path.sep;
    const vendorLex = path.join(frameworkLex, 'backends', 'h5', 'vendor') + path.sep;
    const metaOutput = Object.entries(bundleResult.metafile?.outputs ?? {}).find(([key]) => path.resolve(projectRoot, key) === stageAppJs)?.[1];
    let lguiFrameworkBytes = 0;
    let fairyguiDomBytes = 0;
    for (const [inputKey, info] of Object.entries(metaOutput?.inputs ?? {})) {
      const abs = path.resolve(projectRoot, inputKey);
      const inFramework = abs.startsWith(frameworkLex + path.sep) || abs.startsWith(frameworkDir + path.sep);
      if (!inFramework) continue;
      if (abs.startsWith(vendorLex) || abs.startsWith(vendorReal)) fairyguiDomBytes += info.bytesInOutput;
      else lguiFrameworkBytes += info.bytesInOutput;
    }
    const lguiRuntimeBytes = Math.min(appJsBytes, lguiFrameworkBytes + fairyguiDomBytes);

    const files = walkFiles(outDir);
    const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
    const indexHtmlBytes = files.find(f => f.path === 'index.html')?.bytes ?? 0;
    const uiBytes = files.filter(f => f.path.startsWith('ui/')).reduce((sum, f) => sum + f.bytes, 0);
    const i18nBytes = files.filter(f => f.path.startsWith('i18n/')).reduce((sum, f) => sum + f.bytes, 0);
    const extensions = [...new Set(files.map(f => f.ext))].sort();
    const imageCount = Object.values(web.manifest.packages).reduce((n, p) => n + Object.keys(p.images ?? {}).length, 0);
    const soundCount = Object.values(web.manifest.packages).reduce((n, p) => n + Object.keys(p.sounds ?? {}).length, 0);
    const fontCount = fontNamesList.length;

    const relOut = path.relative(projectRoot, outDir).split(path.sep).join('/');
    const shownOut = !relOut.startsWith('..') && !path.isAbsolute(relOut) ? relOut : outDir;
    const summary = [
      `已构建网页包 → ${shownOut}/（共 ${files.length} 个文件，未压缩总计 ${fmt(totalBytes)}）`,
      `  app.js：${fmt(appJsBytes)}${minify ? '' : '（--no-minify 未压缩）'}`,
      `    其中 LGUI 运行时：${fmt(lguiRuntimeBytes)}（框架 ${fmt(lguiFrameworkBytes)} + FairyGUI-dom ${fmt(fairyguiDomBytes)}）`,
      `  ui/ 与 i18n/：${fmt(uiBytes + i18nBytes)}（图片 ${imageCount} 张、音频 ${soundCount} 个、字体 ${fontCount} 个）`,
      `  index.html：${fmt(indexHtmlBytes)}`
    ];

    return {
      data: {
        outDir,
        minify,
        fileCount: files.length,
        extensions,
        totalBytes,
        appJsBytes,
        lguiRuntimeBytes,
        lguiFrameworkBytes,
        fairyguiDomBytes,
        uiBytes,
        i18nBytes,
        indexHtmlBytes,
        assets: {images: imageCount, sounds: soundCount, fonts: fontCount},
        files
      },
      summary
    };
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
    fs.rmSync(bootOut, {recursive: true, force: true});
  }
}
