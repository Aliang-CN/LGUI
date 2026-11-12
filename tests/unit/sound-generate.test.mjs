// 声音资源的生成：网页界面包带上 ui/ 里登记的 mp3（按资源 ID 命名，和 OpenFairyGUI 写进包里的文件名一致）并记进 manifest.json；
// headless 描述带上每个包的声音和按钮的音效。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bagPanel, writeFixture} from '../helpers/fixture.mjs';
import {generateWeb, generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';

function fixture() {
  const panel = size => bagPanel({size, extra: '<component id="n5" name="quietButton" src="btn00001" xy="200,800" size="160,56"><Button title="静" volume="0"/></component>'})
    .replace('<Button title="出售"/>', '<Button title="出售" sound="ui://cmn00001click001" volume="50"/>');
  const root = writeFixture(undefined, {sounds: true, landscape: panel('1920,1080'), portrait: panel('1080,1920')});
  const btn = path.join(root, 'ui/assets/Bag/Btn.xml');
  fs.writeFileSync(btn, fs.readFileSync(btn, 'utf8').replace('<Button/>', '<Button sound="ui://cmn00001bgm00002" volume="80"/>'));
  return root;
}

test('网页界面包：ui/ 里登记的声音输出成 <包>/<资源ID>.mp3，manifest.json 记着名字和文件；包里写的文件名就是它', async () => {
  const root = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-sound-web-'));
  const result = await generateWeb(path.join(root, 'ui/UI.fairy'), out);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.packages.cmn00001.sounds, {
    click001: {name: 'click', file: 'click001.mp3'}, bgm00001: {name: 'bgm', file: 'bgm00001.mp3'}, bgm00002: {name: 'battle', file: 'bgm00002.mp3'}
  });
  assert.deepEqual(manifest.packages.bag00001.sounds, {});
  assert.deepEqual(fs.readFileSync(path.join(out, 'Common/click001.mp3')), fs.readFileSync(path.join(root, 'ui/assets/Common/sfx/click.mp3')));
  assert.ok(result.files.includes(path.join(out, 'Common/bgm00002.mp3')));
  // OpenFairyGUI 0.7.0 把声音资源写进包里，文件名是 <资源ID>.mp3（FairyGUI-dom 按「包目录 + 文件名」找它）。
  const pkgJson = JSON.parse(fs.readFileSync(path.join(out, 'Common/package.json'), 'utf8'));
  assert.match(Buffer.from(pkgJson.fui, 'base64').toString('latin1'), /click001\.mp3/);
});

test('网页界面包：登记的声音文件不存在时，OpenFairyGUI 校验就报 LGUI-CLI-020', async () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'ui/assets/Common/bgm.mp3'));
  await assert.rejects(generateWeb(path.join(root, 'ui/UI.fairy'), fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-sound-web-'))), e => {
    const errors = e.errors ?? [e];
    return errors.some(x => x.code === 'LGUI-CLI-020' && /bgm\.mp3/.test(x.message));
  });
});

test('headless 描述：每个包的声音；按钮实例和按钮组件的音效（ui://包ID资源ID 换成 ui://包名/声音名）和音量', async () => {
  const root = fixture();
  await generateProjectTypes(root);
  const read = name => JSON.parse(fs.readFileSync(path.join(root, `.lgui/build/headless/${name}.json`), 'utf8'));
  assert.deepEqual(read('Common').sounds, [{id: 'click001', name: 'click'}, {id: 'bgm00001', name: 'bgm'}, {id: 'bgm00002', name: 'battle'}]);
  const bag = read('Bag');
  const btn = bag.components.find(c => c.name === 'Bag/Btn');
  assert.deepEqual([btn.sound, btn.soundVolume], ['ui://Common/battle', 0.8]);
  const children = Object.fromEntries(bag.components.find(c => c.name === 'Bag/BagPanel').children.map(c => [c.name, c.props]));
  assert.deepEqual([children.sellButton.sound, children.sellButton.soundVolume], ['ui://Common/click', 0.5]);
  assert.deepEqual([children.quietButton.sound, children.quietButton.soundVolume], [undefined, 0]);
  assert.equal('sound' in children.gold, false);
});
