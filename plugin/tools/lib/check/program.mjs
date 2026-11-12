// lgui check 的基础：按工程的 tsconfig.json 建 TypeScript program，报类型错误；把 src/ 里的 View 读成结构（给规则用）。
import fs from 'node:fs';
import path from 'node:path';
import {typescript} from '../vendor.mjs';

/** 一条检查结果。 */
export function finding(code, message, fix, {file, line, col, level = 'error'} = {}) {
  return {code, message, fix, file, line, col, level};
}

/** 节点在文件里的行列（从 1 开始）。 */
export function where(root, node) {
  const sf = node.getSourceFile();
  const {line, character} = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return {file: path.relative(root, sf.fileName).split(path.sep).join('/'), line: line + 1, col: character + 1};
}

/** 建 program，返回 { ts, program, findings }。类型错误报 TS 自己的错误码，加上「怎么改」。 */
export function buildProgram(root) {
  const ts = typescript();
  const configFile = path.join(root, 'tsconfig.json');
  const {config, error} = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error) return {ts, program: null, findings: [finding('LGUI-CLI-050', `读不了 tsconfig.json：${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`, '用 lgui init 生成的 tsconfig.json，不要改它。', {file: 'tsconfig.json'})]};
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const findings = ts.getPreEmitDiagnostics(program).filter(d => !d.file || !d.file.fileName.includes('/.lgui/')).map(d => {
    const loc = d.file ? (() => { const {line, character} = d.file.getLineAndCharacterOfPosition(d.start ?? 0); return {file: path.relative(root, d.file.fileName).split(path.sep).join('/'), line: line + 1, col: character + 1}; })() : {};
    return finding(`TS${d.code}`, ts.flattenDiagnosticMessageText(d.messageText, '\n'), '按 TypeScript 的提示改；控件名和类型以 lgui ui list 为准。', loc);
  });
  return {ts, program, findings};
}

/** 网页端宿主目录 host/ 存在时，带 DOM 类型库单独做 strict 类型检查（src/ 继续不引入 DOM）。 */
export function buildHostProgram(root, ts = typescript()) {
  const hostDir = path.join(root, 'host');
  if (!fs.existsSync(hostDir) || !fs.statSync(hostDir).isDirectory()) return {hostProgram: null, hostFiles: [], findings: []};
  const customConfig = path.join(hostDir, 'tsconfig.json');
  let parsed;
  if (fs.existsSync(customConfig)) {
    const {config, error} = ts.readConfigFile(customConfig, ts.sys.readFile);
    if (error) return {hostProgram: null, hostFiles: [], findings: [finding('LGUI-CLI-050', `读不了 host/tsconfig.json：${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`, '修正 host/tsconfig.json，或者删掉它让 lgui check 自动沿用根目录的严格配置。', {file: 'host/tsconfig.json'})]};
    parsed = ts.parseJsonConfigFileContent(config, ts.sys, hostDir);
  } else {
    const {config, error} = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
    if (error) return {hostProgram: null, hostFiles: [], findings: []};
    const hostConfig = {
      compilerOptions: {
        ...(config.compilerOptions ?? {}),
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        baseUrl: '.',
        paths: {
          ...(config.compilerOptions?.paths ?? {}),
          lgui: ['.lgui/framework/index.ts'],
          'lgui/host': ['.lgui/framework/host.ts'],
          'lgui/ui': ['.lgui/build/types/index.d.ts']
        }
      },
      include: ['host', '.lgui/framework/env.d.ts']
    };
    parsed = ts.parseJsonConfigFileContent(hostConfig, ts.sys, root);
  }
  const hostPrefix = path.resolve(hostDir) + path.sep;
  if (!parsed.fileNames.some(f => path.resolve(f).startsWith(hostPrefix))) return {hostProgram: null, hostFiles: [], findings: []};
  const hostProgram = ts.createProgram(parsed.fileNames, parsed.options);
  const findings = ts.getPreEmitDiagnostics(hostProgram).filter(d => !d.file || path.resolve(d.file.fileName).startsWith(hostPrefix)).map(d => {
    const loc = d.file ? (() => { const {line, character} = d.file.getLineAndCharacterOfPosition(d.start ?? 0); return {file: path.relative(root, d.file.fileName).split(path.sep).join('/'), line: line + 1, col: character + 1}; })() : {};
    return finding(`TS${d.code}`, ts.flattenDiagnosticMessageText(d.messageText, '\n'), '按 TypeScript 的提示修改 host/ 里的网页宿主代码。', loc);
  });
  const hostFiles = sourceFiles(root, hostProgram).filter(sf => path.resolve(sf.fileName).startsWith(hostPrefix));
  return {hostProgram, hostFiles, findings};
}

/** src/ 和 tests/ 里的工程源文件（不含 .lgui/）。 */
export function sourceFiles(root, program) {
  // TypeScript 的文件名总是用 /（Windows 上也是 D:/…），比较前统一成本机的写法。
  const base = path.resolve(root) + path.sep;
  return program.getSourceFiles().filter(sf => !sf.isDeclarationFile && !sf.fileName.includes('/.lgui/') && !sf.fileName.includes('/node_modules/') && path.resolve(sf.fileName).startsWith(base));
}

const BASES = ['View', 'ItemView', 'PartView'];

/** 读出文件里的 View 类：{ node, name, kind, statics: Map<名字, 节点>, bind: 对象字面量节点 | null, keys: 节点 | null }。 */
export function viewClasses(ts, sf) {
  const result = [];
  const visit = node => {
    if (ts.isClassDeclaration(node) && node.heritageClauses) {
      const base = node.heritageClauses.flatMap(h => h.types).map(t => t.expression.getText(sf))[0];
      if (BASES.includes(base)) {
        const statics = new Map();
        let bind = null;
        let keys = null;
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || !member.name) continue;
          const name = member.name.getText(sf);
          const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword);
          if (isStatic) statics.set(name, member);
          else if (name === 'bind') bind = member.initializer ?? null;
          else if (name === 'keys') keys = member.initializer ?? null;
        }
        result.push({node, name: node.name?.getText(sf) ?? '(匿名类)', kind: base, statics, bind, keys});
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}

/** 静态字段的值：字符串字面量（含 'x' as const）、布尔、或 null（读不出来）。 */
export function literalValue(ts, expr) {
  if (!expr) return undefined;
  let e = expr;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression?.(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

/** 对象字面量的属性：[{ key, node, value }]。 */
export function objectProps(ts, obj) {
  let e = obj;
  while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
  if (!e || !ts.isObjectLiteralExpression(e)) return null;
  return e.properties.filter(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)).map(p => ({
    key: p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : p.name?.getText(),
    node: p,
    value: ts.isPropertyAssignment(p) ? p.initializer : null
  }));
}
