import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** 检查 probe.ts 的结果（见同目录 README.md）。 */
export function checkFontResult(report) {
  assert.equal(report.fatal, undefined, report.fatal);
  assert.equal(report.missing.rejected, true, '找不到的项目字体要报错');
  assert.equal(report.missing.code, 'LGUI-RT-181');
  assert.match(report.missing.message, /Resources\/UI\/fonts\/Missing/);
  assert.equal(report.registered, 'TMPFont:Noto', '项目字体按名字注册成 FairyGUI 的 TMPFont');
  assert.match(report.atlas, /^Dynamic,True,\d+$/, '动态图集、开多图集');
  assert.equal(report.drawnWith, 'TMPFont:Noto', '没写 font 的文字按 defaultFont 用项目 TMP 字体画');
  assert.ok(report.inFontServedBy.every(name => name === 'Noto'), `项目字体里有的字由它自己出：${report.inFontServedBy.join(',')}`);
  assert.notEqual(report.fallbackName, '', `这台机器上要找到系统回退字体（试过：${report.fallbackCandidates}）`);
  assert.equal(report.notInFontServedBy, report.fallbackName, '项目字体里没有的字由系统回退字体出');
  assert.ok(report.firstLayoutMs >= 0 && report.secondLayoutMs >= 0);
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const report = checkFontResult(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(JSON.stringify({ok: true, file, fallback: report.fallbackName, firstLayoutMs: report.firstLayoutMs, secondLayoutMs: report.secondLayoutMs}));
}
