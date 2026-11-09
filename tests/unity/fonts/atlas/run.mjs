import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {checkAtlasResult} from './checker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.slice(2), value = process.argv[i + 1];
  if (!process.argv[i]?.startsWith('--') || !['editor', 'project', 'evidence'].includes(key) || !value || !path.isAbsolute(value) || options[key])
    throw new Error('Use --editor <Unity.exe> --project <existing isolated exported Unity project> --evidence <fresh directory>, all absolute paths.');
  options[key] = value;
}
for (const key of ['editor', 'project', 'evidence']) if (!options[key]) throw new Error('Missing --' + key);
if (process.version !== 'v24.22.1') throw new Error('Use the repository Node v24.22.1; no version is installed or selected automatically.');
const {editor, project, evidence} = options;
if (fs.existsSync(evidence)) throw new Error('Fresh evidence directory required.');
if (!/^m_EditorVersion:\s*6000\.6\.6f1\s*$/m.test(fs.readFileSync(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'utf8')))
  throw new Error('The project must use Unity 6000.6.6f1.');
for (const part of [project, path.join(project, 'Assets'), path.join(project, 'Packages')])
  if (fs.lstatSync(part).isSymbolicLink()) throw new Error('Use an isolated project with real paths: ' + part);
const helper = path.join(here, 'Assets/Editor/ShadowRuntimeDiagnosis.cs');
const target = path.join(project, 'Assets/Editor/ShadowRuntimeDiagnosis.cs');
if (fs.existsSync(target) && sha(target) !== sha(helper)) throw new Error('A different probe already exists; preserve it and use a fresh isolated project.');
fs.mkdirSync(evidence, {recursive: true});
fs.mkdirSync(path.dirname(target), {recursive: true});
fs.copyFileSync(helper, target);
json(path.join(evidence, 'helper.json'), {source: helper, target, sha256: sha(helper), scope: 'Test-only Editor orchestration and read-only runtime sampling. No product package, game input, font, resolution, renderer or texture mutations.'});
const result = path.join(evidence, 'result.json'), png = path.join(evidence, 'game.png');
const args = ['-batchmode', '-projectPath', project, '-executeMethod', 'LGUIAtlasRetest.ShadowRuntimeDiagnosis.Run',
  '-logFile', path.join(evidence, 'unity.log'), '-lguiAtlasResult', result, '-lguiAtlasPng', png];
const env = {...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH};
json(path.join(evidence, 'command.json'), {editor, args, cwd: project, node: process.version, nodeExecutable: process.execPath, startedUtc: new Date().toISOString()});
const stdout = fs.createWriteStream(path.join(evidence, 'stdout.log'), {flags: 'wx'}), stderr = fs.createWriteStream(path.join(evidence, 'stderr.log'), {flags: 'wx'});
const finished = Promise.all([new Promise(r => stdout.on('finish', r)), new Promise(r => stderr.on('finish', r))]);
const child = spawn(editor, args, {cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
json(path.join(evidence, 'process.json'), {pid: child.pid});
child.stdout.pipe(stdout); child.stderr.pipe(stderr);
let error;
child.on('error', e => {error = {message: e.message, code: e.code}; stdout.end(); stderr.end();});
const exit = await new Promise(resolve => child.on('close', (code, signal) => resolve({code, signal, error: error ?? null})));
await finished;
json(path.join(evidence, 'exit.json'), {...exit, completedUtc: new Date().toISOString()});
if (exit.code !== 0 || !fs.existsSync(result)) {
  console.log(JSON.stringify({ok: false, phase: 'sampler', ...exit, evidence}, null, 2));
  process.exitCode = 1;
} else {
  const sample = JSON.parse(fs.readFileSync(result, 'utf8'));
  const dimensions = checkAtlasResult(sample, {checkDimensions: true, checkShadow: false});
  const shadow = checkAtlasResult(sample, {checkDimensions: false, checkShadow: true});
  json(path.join(evidence, 'dimensions.json'), dimensions);
  json(path.join(evidence, 'shadow.json'), shadow);
  const driver = JSON.parse(fs.readFileSync(result + '.driver.json', 'utf8'));
  const report = {ok: dimensions.ok && shadow.ok, samplerExit: exit.code, dimensionsOK: dimensions.ok, shadowOK: shadow.ok,
    pngPresent: driver.pngPresent, runtimeLogs: driver.logs, evidence,
    scope: 'Geometry regression only. Sampler completion does not assert error-free runtime. Batch PNG can be unavailable; independent real Editor/Player PNG acceptance remains necessary.'};
  json(path.join(evidence, 'summary.json'), report);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
