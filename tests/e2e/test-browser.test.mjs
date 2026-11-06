// lgui test --browser：同一个测试文件分别用 headless 和真浏览器（h5 后端）跑，规则类的结果必须一样；
// 渲染类（关联布局算出来的位置）headless 报 LGUI-RT-260，浏览器里算得出来。这也是列表虚拟化（P3 绑定 / P4 headless）、输入框 maxLength 的共同验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../unit/cli/helpers.mjs';
import {launchBrowser} from '../helpers/browser.mjs';

// 在模板工程的主界面上加：有 maxLength 的输入框、没有 title 子控件的按钮、标签、Check 按钮；再加一个列表不能滚动的界面。
function writeProject(root) {
  const main = path.join(root, 'ui/assets/Main');
  const add = file => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  </displayList>', `    <inputtext id="n20" name="nameInput" xy="40,40" size="400,60" fontSize="30" color="#ffffff" autoSize="none" singleLine="true" maxLength="5" text=""/>
    <component id="n21" name="chatBar" src="chatbar1" xy="40,120" size="400,60"><Button title="欢迎"/></component>
    <component id="n22" name="frame" src="framelb1" xy="40,200" size="400,60"><Label title="标题"/></component>
    <component id="n23" name="toggle" src="toggle01" xy="40,280" size="120,60"/>
  </displayList>`));
  add(path.join(main, 'MainView.xml'));
  add(path.join(main, 'MainView@portrait.xml'));
  const files = {
    'ChatBar.xml': `<component size="400,60" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="400,60" type="rect" fillColor="#334455"/>
    <text id="n1" name="text" xy="0,0" size="400,60" fontSize="24" color="#ffffff" text=""/>
  </displayList>
  <Button/>
</component>`,
    'Frame.xml': `<component size="400,60" extention="Label">
  <displayList>
    <text id="n1" name="title" xy="0,0" size="400,60" fontSize="24" color="#ffffff" autoSize="none" text="默认"/>
  </displayList>
  <Label/>
</component>`,
    'Toggle.xml': `<component size="120,60" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="120,60" type="rect" fillColor="#556677"/>
  </displayList>
  <Button mode="Check"/>
</component>`,
    'Tags.xml': `<component size="600,200">
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="600,200" type="rect" fillColor="#223344"/>
    <list id="n1" name="tags" xy="0,0" size="600,60" layout="row" defaultItem="ui://main0001tagitem1"/>
  </displayList>
</component>`,
    'Tag.xml': `<component size="120,60">
  <displayList>
    <text id="n1" name="title" xy="0,0" size="120,60" fontSize="24" color="#ffffff" autoSize="none" text=""/>
  </displayList>
</component>`
  };
  for (const [name, xml] of Object.entries(files)) fs.writeFileSync(path.join(main, name), `<?xml version="1.0" encoding="utf-8"?>\n${xml}\n`);
  const pkg = path.join(main, 'package.xml');
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('  </resources>', `    <component id="chatbar1" name="ChatBar.xml" path="/"/>
    <component id="framelb1" name="Frame.xml" path="/"/>
    <component id="toggle01" name="Toggle.xml" path="/"/>
    <component id="tagsvw01" name="Tags.xml" path="/" exported="true"/>
    <component id="tagitem1" name="Tag.xml" path="/" exported="true"/>
  </resources>`));
  fs.writeFileSync(path.join(root, 'tests/rules.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui, View, ItemView } from 'lgui';
import app from '../src/main';

class TagView extends ItemView { static component = 'Main/Tag'; bind = { title: { text: (d: { label: string }) => d.label } }; }
class TagsView extends View { static component = 'Main/Tags'; static layer = 'popup' as const; bind = { tags: { items: [{ label: '甲' }, { label: '乙' }], item: TagView } }; }

test('点按钮，显示点击次数', async () => {
  const t = await lgui.testing.start(app);
  await t.click('Main/MainView.button');
  assert.equal(t.text('Main/MainView.status'), '点了 1 次');
  t.end();
});

test('打字遵守 maxLength', async () => {
  const t = await lgui.testing.start(app);
  await t.type('Main/MainView.nameInput', 'abcdefgh');
  assert.equal(t.text('Main/MainView.nameInput'), 'abcde');
  t.end();
});

test('按钮没有 title 子控件：读文字报 LGUI-RT-262', async () => {
  const t = await lgui.testing.start(app);
  assert.throws(() => t.text('Main/MainView.chatBar'), /LGUI-RT-262/);
  t.end();
});

test('标签的 title 写进 title 子控件', async () => {
  const t = await lgui.testing.start(app);
  assert.deepEqual([t.text('Main/MainView.frame'), t.text('Main/MainView.frame.title')], ['标题', '标题']);
  t.end();
});

test('Check 按钮点一下选中，再点取消', async () => {
  const t = await lgui.testing.start(app);
  t.setInputType('touch');
  await t.click('Main/MainView.toggle');
  const first = t.page('Main/MainView.toggle.button');
  await t.click('Main/MainView.toggle');
  assert.deepEqual([first, t.page('Main/MainView.toggle.button')], ['down', 'up']);
  t.end();
});

test('不能滚动的列表绑定数据', async () => {
  const t = await lgui.testing.start(app);
  await t.open(TagsView);
  assert.deepEqual([t.items('Main/Tags.tags'), t.text('Main/Tags.tags[1].title')], [2, '乙']);
  t.end();
});

test('关联布局算出来的位置', async () => {
  const t = await lgui.testing.start(app, { screen: { width: 2400, height: 1080 } });
  const r = lgui.ui.find('Main/MainView.button');
  assert.ok(r);
  assert.equal(Math.round(r.x + r.width / 2), 1200);
  t.end();
});
`);
}

const outcomes = json => Object.fromEntries(json.data.results.map(r => [r.name, r.ok]));

test('lgui test 和 lgui test --browser：规则类的结果一样；关联布局的位置 headless 报 LGUI-RT-260，浏览器里算得出来', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  await browser.close();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-test-browser-'));
  assert.equal((await run(['init', 'game'], parent)).code, 0);
  const root = path.join(parent, 'game');
  writeProject(root);

  const headless = await run(['test', 'tests/rules.test.ts', '--json'], root);
  const h = JSON.parse(headless.stdout);
  const browserRun = await run(['test', 'tests/rules.test.ts', '--browser', '--json'], root);
  const b = JSON.parse(browserRun.stdout);
  assert.equal(b.data.backend, 'h5');
  assert.deepEqual([h.data.files, b.data.files], [['tests/rules.test.ts'], ['tests/rules.test.ts']]);
  const [ho, bo] = [outcomes(h), outcomes(b)];
  assert.equal(Object.keys(bo).length, 7, JSON.stringify(b.data.results));

  for (const name of ['点按钮，显示点击次数', '打字遵守 maxLength', '按钮没有 title 子控件：读文字报 LGUI-RT-262', '标签的 title 写进 title 子控件', 'Check 按钮点一下选中，再点取消']) {
    assert.deepEqual([name, ho[name], bo[name]], [name, true, true], `${headless.stdout}\n${browserRun.stdout}`);
  }
  // 列表能不能开虚拟列表：两边的规则一样（P3 让绑定只给能滚动的列表开虚拟列表之前两边都报错，之后两边都通过）。
  assert.equal(ho['不能滚动的列表绑定数据'], bo['不能滚动的列表绑定数据'], `${headless.stdout}\n${browserRun.stdout}`);
  // 渲染类：headless 不算关联布局，读到就报 LGUI-RT-260；浏览器里按真实布局算。
  assert.equal(ho['关联布局算出来的位置'], false);
  assert.match(h.data.failed.find(f => f.name === '关联布局算出来的位置').error, /LGUI-RT-260/);
  assert.equal(bo['关联布局算出来的位置'], true, browserRun.stdout);
});
