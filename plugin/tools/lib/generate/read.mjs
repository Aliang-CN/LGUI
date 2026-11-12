// 读取 ui/ 里的 FairyGUI 工程：先用 OpenFairyGUI 校验，再读成 Document。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openFairyGUI} from '../vendor.mjs';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {readUiModel} from './model.mjs';

const SYNTH_SOUND_TEST = /\b(?:sound|showSound|hideSound)="synth:\/\/[A-Za-z0-9][A-Za-z0-9._/-]*"/;
const SYNTH_SOUND_REPLACE = /\b(sound|showSound|hideSound)="synth:\/\/[A-Za-z0-9][A-Za-z0-9._/-]*"/g;

function hasSynthSoundInUi(uiDir) {
  const assets = path.join(uiDir, 'assets');
  if (!fs.existsSync(assets)) return false;
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).some(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.xml') && SYNTH_SOUND_TEST.test(fs.readFileSync(path.join(dir, e.name), 'utf8'))
  );
  return walk(assets);
}

function mirrorUiWithoutSynthSound(uiDir, tmpUi) {
  const copyTree = (from, to) => {
    fs.mkdirSync(to, {recursive: true});
    for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'art-src' || entry.name === 'fonts') continue;
        copyTree(src, dst);
      } else if (entry.name.endsWith('.xml')) {
        const content = fs.readFileSync(src, 'utf8');
        fs.writeFileSync(dst, content.replace(SYNTH_SOUND_REPLACE, '$1=""'));
      } else {
        fs.copyFileSync(src, dst);
      }
    }
  };
  copyTree(uiDir, tmpUi);
}

// OpenFairyGUI 生成时会往控制台打日志；收集起来放进结果，不让它混进 --json 输出。
export async function quiet(run) {
  const log = [];
  const saved = {log: console.log, info: console.info, warn: console.warn};
  console.log = console.info = console.warn = (...args) => log.push(args.join(' '));
  try {
    return {value: await run(), log};
  } finally {
    Object.assign(console, saved);
  }
}

// 报错里的文件：相对工程根目录（ui/UI.fairy 的上一级），用 /。
// OpenFairyGUI 给的路径可能是解开符号链接以后的（macOS 的 /var → /private/var），对不上时都换成真实路径再比。
const projectFile = (fairyPath, file) => {
  const root = path.dirname(path.dirname(fairyPath));
  let rel = path.relative(root, file);
  if (rel.startsWith('..')) try { rel = path.relative(fs.realpathSync(root), fs.realpathSync(file)); } catch { /* 文件不在：照原样 */ }
  return rel.split(path.sep).join('/');
};

// OpenFairyGUI 的问题给的是读不了的文件（sourcePath），或者包 ID、资源 ID、元素 ID（path 是它内部的数据路径）：换成文件和行号。
function locate(fairyPath, issue) {
  if (issue.sourcePath) return {file: projectFile(fairyPath, path.resolve(issue.sourcePath))};
  try {
    const model = readUiModel(fairyPath);
    const pkg = model.byId.get(issue.packageId) ?? model.packages.find(p => p.resources.some(r => r.id === issue.resourceId));
    const component = pkg?.components.find(c => c.id === issue.resourceId);
    const file = component?.file ?? pkg?.resources.find(r => r.id === issue.resourceId)?.file ?? pkg?.file;
    return file ? {file: projectFile(fairyPath, file), line: component?.children.find(c => c.id === issue.nodeId)?.line} : {};
  } catch {
    return {}; // XML 本身写错了，读不出结构
  }
}

// 校验不过报 LGUI-CLI-020，附上 OpenFairyGUI 返回的每一条问题。
export async function readUiProject(fairyPath) {
  if (!fs.existsSync(fairyPath)) {
    throw new LgCliError('LGUI-CLI-020', `找不到界面工程文件 ${projectFile(fairyPath, fairyPath)}。`, {file: projectFile(fairyPath, fairyPath), fix: '确认工程里有 ui/UI.fairy；没有就用 lgui init 新建工程。'});
  }
  const {coreNode, functions} = openFairyGUI();
  let {value: report} = await quiet(() => functions.validateProjectNode(fairyPath));
  if (report.status !== 'valid') {
    const uiDir = path.dirname(fairyPath);
    if (hasSynthSoundInUi(uiDir)) {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-uam-'));
      const tmpUi = path.join(tmpRoot, 'ui');
      try {
        mirrorUiWithoutSynthSound(uiDir, tmpUi);
        const tmpFairy = path.join(tmpUi, path.basename(fairyPath));
        const retried = await quiet(() => functions.validateProjectNode(tmpFairy));
        report = {
          ...retried.value,
          diagnostics: (retried.value.diagnostics ?? []).map(d => d.sourcePath
            ? {...d, sourcePath: path.join(uiDir, path.relative(tmpUi, path.resolve(d.sourcePath)))}
            : d)
        };
      } finally {
        fs.rmSync(tmpRoot, {recursive: true, force: true});
      }
    }
  }
  if (report.status !== 'valid') {
    const issues = report.diagnostics.length ? report.diagnostics : [{message: `校验结果是 ${report.status}`}];
    throw new LgCliErrors(issues.map(issue => {
      const at = locate(fairyPath, issue);
      return new LgCliError('LGUI-CLI-020', `界面工程校验没通过：${issue.message ?? JSON.stringify(issue)}${issue.nodeId ? `（元素 ${issue.nodeId}）` : ''}`, {
        file: at.file,
        line: at.line ?? issue.line,
        fix: '按提示改 ui/ 里对应的文件。'
      });
    }));
  }
  return new coreNode.NodeIO().readProject(fairyPath);
}
