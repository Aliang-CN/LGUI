// lgui test --browser：同一个测试文件分别用 headless 和真浏览器（h5 后端）跑，规则类的结果必须一样；
// 渲染类（关联布局算出来的位置）和改属性的齿轮管着的值 headless 报 LGUI-RT-260，浏览器里读得到。
// 这也是列表虚拟化（绑定只给能滚动的列表开虚拟列表、headless 照浏览器的规则执行）、输入框 maxLength 的共同验收：两边都断言具体结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../unit/cli/helpers.mjs';
import {launchBrowser} from '../helpers/browser.mjs';

// 在模板工程的主界面上加：有 maxLength 的输入框、没有 title 子控件的按钮、标签、Check 按钮；
// 再加三个界面：列表不能滚动的、列表能滚动的（50 项）、有 gearText 的文字。
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
    'ScrollTags.xml': `<component size="600,200">
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="600,200" type="rect" fillColor="#223344"/>
    <list id="n1" name="tags" xy="0,0" size="600,60" layout="row" overflow="scroll" scrollBar="hidden" defaultItem="ui://main0001tagitem1"/>
  </displayList>
</component>`,
    'Gears.xml': `<component size="600,200">
  <controller name="state" pages="0,a,1,b" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="600,200" type="rect" fillColor="#223344"/>
    <text id="n1" name="label" xy="0,0" size="300,60" fontSize="24" color="#ffffff" autoSize="none" text="甲"><gearText controller="state" pages="1" values="乙" default="甲"/></text>
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
    <component id="scrlvw01" name="ScrollTags.xml" path="/" exported="true"/>
    <component id="gearsvw1" name="Gears.xml" path="/" exported="true"/>
    <component id="tagitem1" name="Tag.xml" path="/" exported="true"/>
  </resources>`));
  fs.writeFileSync(path.join(root, 'tests/rules.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui, View, ItemView } from 'lgui';
import app from '../src/main';

class TagView extends ItemView { static component = 'Main/Tag'; bind = { title: { text: (d: { label: string }) => d.label } }; }
class TagsView extends View { static component = 'Main/Tags'; static layer = 'popup' as const; bind = { tags: { items: [{ label: '甲' }, { label: '乙' }], item: TagView } }; }
class ScrollTagsView extends View {
  static component = 'Main/ScrollTags';
  static layer = 'popup' as const;
  bind = { tags: { items: Array.from({ length: 50 }, (_, i) => ({ label: \`项\${i}\` })), item: TagView } };
  isVirtual(): boolean { return (this.ui as unknown as { tags: { virtual: boolean } }).tags.virtual; }
}
class GearsView extends View { static component = 'Main/Gears'; static layer = 'popup' as const; bind = {}; }

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

test('能滚动的列表经绑定开成虚拟列表', async () => {
  const t = await lgui.testing.start(app);
  const view = await t.open(ScrollTagsView);
  assert.deepEqual([view.isVirtual(), t.items('Main/ScrollTags.tags'), t.text('Main/ScrollTags.tags[1].title')], [true, 50, '项1']);
  t.end();
});

test('gearText 管着的文字', async () => {
  const t = await lgui.testing.start(app);
  await t.open(GearsView);
  assert.equal(t.text('Main/Gears.label'), '甲');
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

test('lgui test 和 lgui test --browser：规则类的结果一样；关联布局的位置、gearText 管着的文字 headless 报 LGUI-RT-260，浏览器里读得到', async t => {
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
  assert.equal(Object.keys(bo).length, 9, JSON.stringify(b.data.results));

  // 规则类两边都通过（每个测试里断言的是具体结果）。列表虚拟化：不能滚动的列表绑定数据不开虚拟列表、两项都在；能滚动的开成虚拟列表。
  for (const name of ['点按钮，显示点击次数', '打字遵守 maxLength', '按钮没有 title 子控件：读文字报 LGUI-RT-262', '标签的 title 写进 title 子控件', 'Check 按钮点一下选中，再点取消', '不能滚动的列表绑定数据', '能滚动的列表经绑定开成虚拟列表']) {
    assert.deepEqual([name, ho[name], bo[name]], [name, true, true], `${headless.stdout}\n${browserRun.stdout}`);
  }
  // headless 不算关联布局、不模拟改属性的齿轮，读到就报 LGUI-RT-260；浏览器里读得到真实的值。
  for (const name of ['关联布局算出来的位置', 'gearText 管着的文字']) {
    assert.deepEqual([name, ho[name], bo[name]], [name, false, true], `${headless.stdout}\n${browserRun.stdout}`);
    assert.match(h.data.failed.find(f => f.name === name).error, /LGUI-RT-260/);
  }
});
