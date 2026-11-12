// A disposable inventory workspace: real application and action imports share
// one module graph; only generated UI/config/storage namespace live in temp.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyFramework} from '../../../plugin/tools/lib/commands/init.mjs';
import {readProject} from '../../../plugin/tools/lib/project.mjs';
import {generateWeb, generateProjectTypes, headlessDir, uiProjectPath} from '../../../plugin/tools/lib/generate/index.mjs';
import {readUiModel} from '../../../plugin/tools/lib/generate/model.mjs';
import {extractTexts, generateTranslations, translationMaps} from '../../../plugin/tools/lib/generate/i18n.mjs';
import {readTexts} from '../../../plugin/tools/lib/dev/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');
const source = path.join(repository, 'examples/inventory');
const codePath = file => JSON.stringify(file.split(path.sep).join('/'));

function layoutOf(packages) {
  const components = new Map(packages.flatMap(pkg => pkg.components.map(component => [component.name, component])));
  return {components: [...components.values()].filter(component => !component.name.endsWith('@portrait')).map(component => ({
    name: component.name, controllers: component.controllers.map(controller => controller.name),
    children: component.children.filter(child => child.name).map(child => ({name: child.name, kind: child.kind,
      text: ['text', 'richtext', 'input'].includes(child.kind) || components.get(child.ref)?.extension === 'Button',
      // Virtual lists instantiate visible rows only. The shared inventory action
      // snapshots record the full Model and validate each explicitly selected row.
      itemTexts: []}))
  }))};
}

/** coverageCapture opts into the Native Inspector screenshot handshake only. */
export async function createInventoryContext({coverageCapture = false} = {}) {
  if (typeof coverageCapture !== 'boolean') throw new Error('LGUI-RT-001 coverageCapture must be an explicit boolean.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-inventory-player-'));
  fs.mkdirSync(path.join(root, '.lgui'), {recursive: true});
  fs.mkdirSync(path.join(root, 'src'), {recursive: true});
  fs.mkdirSync(path.join(root, 'conformance/cases'), {recursive: true});
  const config = JSON.parse(fs.readFileSync(path.join(source, '.lgui/project.json'), 'utf8'));
  config.name = 'inventory-stage3-acceptance';
  config.unityProject = null;
  fs.writeFileSync(path.join(root, '.lgui/project.json'), JSON.stringify(config, null, 2) + '\n');
  copyFramework(path.join(root, '.lgui/framework'));
  fs.cpSync(path.join(source, 'ui'), path.join(root, 'ui'), {recursive: true});
  fs.cpSync(path.join(source, 'i18n'), path.join(root, 'i18n'), {recursive: true});
  fs.writeFileSync(path.join(root, 'src/main.ts'), `export {default} from ${codePath(path.join(source, 'src/main.ts'))};\n`);
  fs.copyFileSync(path.join(repository, 'tests/conformance/harness.ts'), path.join(root, 'conformance/harness.ts'));
  const caseFile = (name, entry) => fs.writeFileSync(path.join(root, 'conformance/cases', name + '.ts'), entry);
  caseFile('inventory', `import {runInventoryAcceptance} from ${codePath(path.join(here, 'inventory.ts'))};
export default {screen:{width:1280,height:720},run:runInventoryAcceptance};\n`);
  caseFile('format', `import {runFormatProbe} from ${codePath(path.join(here, 'format.ts'))};
export default {screen:{width:1280,height:720},run:runFormatProbe};\n`);
  caseFile('memory', `import {runArtTextCycles} from ${codePath(path.join(here, 'memory.ts'))};
declare const CS:{LGUI:{Tests:{PlayerAcceptance:{CollectManaged(done:(value:string)=>void):void}}}};
type Host={__lguiMemoryPoint?:{cycle:number;native:object};__lguiResumeSample?: (value:object)=>void};
const host=globalThis as unknown as Host;
export default {screen:{width:1280,height:720},run: (t: Parameters<typeof runArtTextCycles>[0])=>runArtTextCycles(t,{cycles:200,
  sample:async(cycle:number)=>{
    const snapshot=await new Promise<string>(resolve=>CS.LGUI.Tests.PlayerAcceptance.CollectManaged(resolve));
    host.__lguiMemoryPoint={cycle,native:JSON.parse(snapshot) as object};
    return new Promise<object>(resolve=>{host.__lguiResumeSample=value=>{delete host.__lguiMemoryPoint;delete host.__lguiResumeSample;resolve(value);};});
  }
})};\n`);
  caseFile('memory-settled', `import {runArtTextCycles} from ${codePath(path.join(here, 'memory.ts'))};
type Series='warmup'|'measured';
type Host={__lguiMemoryPoint?:{series:Series;cycle:number};__lguiResumeSample?:(value:object)=>void};
const host=globalThis as unknown as Host;
const sample=(series:Series)=>async(cycle:number):Promise<object>=>{
  if(host.__lguiMemoryPoint || host.__lguiResumeSample)throw new Error('LGUI-RT-001 A memory sample checkpoint is already pending.');
  return new Promise<object>(resolve=>{
    host.__lguiResumeSample=value=>{delete host.__lguiMemoryPoint;delete host.__lguiResumeSample;resolve(value);};
    host.__lguiMemoryPoint={series,cycle};
  });
};
const executedCycles=(result:object):number=>{
  const value=result as {cycles:number;warmupCycles:number};
  if(value.cycles!==200 || value.warmupCycles!==1)throw new Error('LGUI-RT-001 The settled control requires 200 cycles plus the unchanged one-cycle internal warmup in each series.');
  return value.cycles+value.warmupCycles;
};
export default {screen:{width:1280,height:720},async run(t:Parameters<typeof runArtTextCycles>[0]){
  const warmup=await runArtTextCycles(t,{cycles:200,sample:sample('warmup')});
  const measured=await runArtTextCycles(t,{cycles:200,sample:sample('measured')});
  return {warmup,measured,totalExecutedCycles:executedCycles(warmup)+executedCycles(measured),
    interpretation:'One application and VM: full 200-cycle warmup series, then full 200-cycle measured series; both original one-cycle internal warmups and all results are retained (402 executed cycles).'};
}};\n`);
  caseFile('coverage', `import {runBindingCoverage} from ${codePath(path.join(here, 'coverage.ts'))};
import type {CoverageCheckpoint} from ${codePath(path.join(here, 'coverage.ts'))};
declare const CS:unknown;
type Host={__lguiFixtureBase?:string;__lguiCoverageCapture?:(name:CoverageCheckpoint)=>Promise<void>;
  __lguiCoverageCaptureEnabled?:boolean;__lguiCoveragePoint?:{name:CoverageCheckpoint;sequence:number};
  __lguiResumeCoverage?:(name:CoverageCheckpoint)=>boolean};
const host=globalThis as unknown as Host;
host.__lguiCoverageCaptureEnabled=${JSON.stringify(coverageCapture)} && typeof CS!=='undefined';
let sequence=0;
const nativeCheckpoint=(name:CoverageCheckpoint):Promise<void>=>{
  if(host.__lguiCoveragePoint || host.__lguiResumeCoverage)throw new Error('LGUI-RT-001 A coverage screenshot checkpoint is already pending.');
  return new Promise<void>(resolve=>{
    host.__lguiResumeCoverage=resumed=>{
      if(resumed!==name)throw new Error('LGUI-RT-001 Coverage screenshot resume name does not match the pending checkpoint.');
      delete host.__lguiCoveragePoint;delete host.__lguiResumeCoverage;resolve();return true;
    };
    host.__lguiCoveragePoint={name,sequence:++sequence};
  });
};
export default {screen:{width:1280,height:720},run:(t:Parameters<typeof runBindingCoverage>[0])=>{
  const base=host.__lguiFixtureBase;
  if(!base)throw new Error('LGUI-RT-001 An explicit gated HTTP fixture origin is required.');
  const onCheckpoint=typeof host.__lguiCoverageCapture==='function' ? host.__lguiCoverageCapture
    : host.__lguiCoverageCaptureEnabled ? nativeCheckpoint : undefined;
  return runBindingCoverage(t,{imageURL:base+'/gated.png',releaseURL:base+'/release',onCheckpoint});
}};\n`);
  const project = readProject(root);
  await generateWeb(uiProjectPath(root), path.join(root, '.lgui', 'build', 'web', 'ui'));
  await generateProjectTypes(root, {validated: true});
  const model = readUiModel(uiProjectPath(root));
  const texts = readTexts(root, project.languages);
  generateTranslations(root, model, project.languages, path.join(root, '.lgui/build/web/i18n'), project.defaultLanguage, {format: 'json'});
  const packages = fs.readdirSync(headlessDir(root)).map(file => JSON.parse(fs.readFileSync(path.join(headlessDir(root), file), 'utf8')));
  fs.writeFileSync(path.join(root, 'conformance/layout.ts'), 'export default ' + JSON.stringify(layoutOf(packages)) + ';\n');
  return {root, project, packages, texts, translations: translationMaps(extractTexts(model), texts, project.defaultLanguage),
    deps: JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/deps.json'), 'utf8'))};
}
