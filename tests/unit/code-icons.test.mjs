// 代码图标（icon://<名字>）：注册校验、SVG 编码、headless 控件与绑定、拖放默认跟手图、Unity 运行时明确拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importTs} from '../helpers/ts.mjs';
import {loadFramework, started} from '../helpers/framework.mjs';

const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;
const unityObjectsEntry = fileURLToPath(new URL('../../plugin/framework/backends/unity/adapter/objects.ts', import.meta.url));

function makeCodeIconProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-code-icons-'));
  const cmn = path.join(root, 'ui/assets/Common');
  const main = path.join(root, 'ui/assets/Main');
  fs.mkdirSync(cmn, {recursive: true});
  fs.mkdirSync(main, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="ci000001" type="Layabox" version="3.0"/>'));
  fs.writeFileSync(path.join(cmn, 'package.xml'), xml(`<packageDescription id="cmn00001"><resources>
    <component id="acthintb" name="ActionHintBar.xml" path="/" exported="true"/>
    <component id="acthint1" name="ActionHint.xml" path="/" exported="true"/>
    <component id="iconbtn1" name="IconButton.xml" path="/" exported="true"/>
    <component id="iconlbl1" name="IconLabel.xml" path="/" exported="true"/>
  </resources></packageDescription>`));
  fs.writeFileSync(path.join(cmn, 'ActionHint.xml'), xml(`<component size="200,48"><displayList>
    <text id="n0" name="key" xy="0,0" size="80,48" fontSize="22" autoSize="shrink" singleLine="true" text="Esc"/>
    <text id="n1" name="label" xy="88,0" size="112,48" fontSize="22" autoSize="shrink" singleLine="true" text="返回"/>
  </displayList></component>`));
  fs.writeFileSync(path.join(cmn, 'ActionHintBar.xml'), xml(`<component size="1920,64"><displayList>
    <list id="n0" name="list" xy="0,0" size="1920,64" layout="row" defaultItem="ui://cmn00001acthint1"/>
  </displayList></component>`));
  fs.writeFileSync(path.join(cmn, 'IconButton.xml'), xml(`<component size="160,64" extention="Button">
    <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
    <displayList>
      <loader id="n0" name="icon" xy="8,8" size="48,48" align="center" vAlign="middle" fill="scale"/>
      <text id="n1" name="title" xy="64,8" size="88,48" fontSize="24" autoSize="shrink" singleLine="true" text="按钮"/>
    </displayList>
    <Button mode="Check"/>
  </component>`));
  fs.writeFileSync(path.join(cmn, 'IconLabel.xml'), xml(`<component size="200,64" extention="Label"><displayList>
    <loader id="n0" name="icon" xy="8,8" size="48,48" align="center" vAlign="middle" fill="scale"/>
    <text id="n1" name="title" xy="64,8" size="128,48" fontSize="24" autoSize="shrink" singleLine="true" text="标签"/>
  </displayList><Label/></component>`));
  fs.writeFileSync(path.join(main, 'package.xml'), xml(`<packageDescription id="main0001"><resources>
    <component id="panel001" name="Panel.xml" path="/" exported="true"/>
  </resources></packageDescription>`));
  fs.writeFileSync(path.join(main, 'Panel.xml'), xml(`<component size="1920,1080"><displayList>
    <graph id="n0" name="safe" xy="0,0" size="1920,1080" touchable="false"/>
    <loader id="n1" name="hero" xy="40,40" size="96,96" url="icon://play" fill="scale"/>
    <component id="n2" name="toggle" pkg="cmn00001" src="iconbtn1" xy="40,160" size="160,64">
      <Button title="播放" icon="icon://play" selectedIcon="icon://pause"/>
    </component>
    <component id="n3" name="badge" pkg="cmn00001" src="iconlbl1" xy="40,240" size="200,64">
      <Label title="星标" icon="icon://star"/>
    </component>
    <graph id="n4" name="dropZone" xy="400,160" size="160,160" type="rect" fillColor="#223344"/>
  </displayList></component>`));
  return root;
}

const ICONS = {
  play: {
    viewBox: [0, 0, 48, 48],
    shapes: [
      {type: 'circle', cx: 24, cy: 24, r: 22, fill: '#1d3557', stroke: '#a8dadc', strokeWidth: 2},
      {type: 'polygon', points: [[19, 14], [19, 34], [35, 24]], fill: '#ffffff'}
    ]
  },
  pause: {
    width: 48,
    height: 48,
    shapes: [
      {type: 'rect', x: 14, y: 12, width: 7, height: 24, rx: 2, fill: '#ffffff'},
      {type: 'rect', x: 27, y: 12, width: 7, height: 24, rx: 2, fill: '#ffffff'}
    ]
  },
  star: {
    width: 40,
    height: 40,
    draw(g, w, h) {
      g.fillStyle = '#ffd166';
      g.fillRect(4, 4, w - 8, h - 8);
    }
  }
};

test('代码图标注册表：校验名字与图元参数，序列化五种矢量图元并安全转义单引号', async () => {
  const fw = await loadFramework();
  fw.clearIcons();
  assert.throws(() => fw.registerIcons({'icon://play': ICONS.play}), e => e.code === 'LGUI-RT-072' && /带了 icon:\/\//.test(e.message));
  assert.throws(() => fw.registerIcons({'bad name': ICONS.play}), e => e.code === 'LGUI-RT-072');
  assert.throws(() => fw.registerIcons({empty: {shapes: []}}), e => e.code === 'LGUI-RT-072');
  assert.throws(() => fw.registerIcons({badSize: {width: 0, height: 32, shapes: [{type: 'circle', cx: 8, cy: 8, r: 4, fill: '#fff'}]}}), e => e.code === 'LGUI-RT-072');
  assert.throws(() => fw.registerIcons({badBox: {viewBox: [0, 0, -10, 10], shapes: [{type: 'circle', cx: 8, cy: 8, r: 4, fill: '#fff'}]}}), e => e.code === 'LGUI-RT-072');
  assert.throws(() => fw.registerIcons({badKind: {shapes: [{type: 'ellipse'}]}}), e => e.code === 'LGUI-RT-072');

  fw.registerIcons({
    all: {
      viewBox: [0, 0, 32, 32],
      shapes: [
        {type: 'path', d: 'M2 2 L30 2', stroke: "url('#g')", strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'bevel', opacity: 0.8},
        {type: 'circle', cx: 16, cy: 16, r: 6, fill: '#ff0000'},
        {type: 'rect', x: 4, y: 20, width: 10, height: 8, rx: 2, fill: '#00ff00'},
        {type: 'polygon', points: [[20, 20], [28, 20], [24, 28]], fill: '#0000ff'},
        {type: 'line', x1: 0, y1: 31, x2: 32, y2: 31, stroke: '#ffffff', strokeWidth: 1}
      ]
    }
  });
  const icon = fw.lookupIcon('icon://all');
  assert.ok(icon && icon.kind === 'shapes');
  const dataUrl = fw.iconSvgDataUrl(icon);
  assert.equal(fw.iconSvgDataUrl(icon), dataUrl, '第二次读取命中缓存');
  assert.ok(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.equal(dataUrl.includes("'"), false, "单引号必须编码成 %27，避免破坏 CSS url('...')");
  const decoded = decodeURIComponent(dataUrl.slice('data:image/svg+xml;charset=utf-8,'.length));
  for (const tag of ['<path ', '<circle ', '<rect ', '<polygon ', '<line ']) {
    assert.ok(decoded.includes(tag), `SVG 缺少 ${tag}`);
  }
  fw.clearIcons();
});

test('headless + 绑定 + 拖放：加载器、按钮（含 selectedIcon）、标签同步使用 icon://，不闪占位图，未注册报 LGUI-RT-072', async () => {
  const root = makeCodeIconProject();
  const ctx = await started({
    root,
    config: {placeholder: 'icon://pause'},
    app: {icons: ICONS}
  });
  const {fw, backend, sim} = ctx;
  const {lgui, View, pick} = fw;
  const state = lgui.Model({playing: false, heroIcon: 'icon://play', badgeIcon: 'icon://star'});
  const dropped = [];
  const history = [];

  class PanelView extends View {
    static component = 'Main/Panel';
    static layer = 'page';
    static fullScreen = true;
    static bothOrientations = true;
    bind = {
      hero: {icon: pick(state, s => s.heroIcon)},
      toggle: {
        selected: pick(state, s => s.playing),
        click: () => state.set({playing: !state.get().playing})
      },
      badge: {
        icon: pick(state, s => s.badgeIcon),
        dragData: 'star-badge'
      },
      dropZone: {
        drop: data => dropped.push(data)
      }
    };
  }

  await lgui.ui.open(PanelView);
  const comp = lgui.ui.get(PanelView).__component;
  const hero = comp.child('hero');
  const toggle = comp.child('toggle');
  const badge = comp.child('badge');

  assert.equal(hero.url, 'icon://play');
  assert.equal(toggle.icon, 'icon://play');
  assert.equal(toggle.child('icon').url, 'icon://play');
  assert.equal(badge.icon, 'icon://star');
  assert.equal(badge.child('icon').url, 'icon://star');

  // 监听加载器加载事件：切到另一个 icon:// 时直接同步换上，不先经过 placeholder。
  hero.onLoad(() => history.push(hero.url));
  state.set({heroIcon: 'icon://star'});
  assert.deepEqual(history, ['icon://star']);

  // Check 按钮选中时，下一帧写回绑定状态后 headless 的 icon 子控件跟着切到 selectedIcon。
  await sim.click(backend, toggle);
  await sim.advance(backend, 16);
  assert.equal(state.get().playing, true);
  assert.equal(toggle.child('icon').url, 'icon://pause');

  // 标签上的 dragData 默认用标签自己的 icon://star 当跟手图标，尺寸取代码图标定义的 40×40。
  assert.deepEqual(backend.imageSize('icon://star'), {width: 40, height: 40});
  await sim.dragTo(backend, badge, comp.child('dropZone'));
  assert.deepEqual(dropped, ['star-badge']);

  // 未注册的 icon:// 在绑定和直接赋值时都报 LGUI-RT-072。
  assert.throws(() => state.set({badgeIcon: 'icon://nope'}), e => e.code === 'LGUI-RT-072');
  assert.throws(() => { hero.url = 'icon://missing'; }, e => e.code === 'LGUI-RT-072');
  fw.clearIcons();
});

test('Unity 运行时：启动注册代码图标或给控件赋 icon:// 都明确报 LGUI-RT-072', async () => {
  const fw = await loadFramework();
  const {createObjectAdapter} = await importTs(unityObjectsEntry);
  class Listener { Add() {} Remove() {} AddCapture() {} RemoveCapture() {} }
  class Base {
    name = 'x'; visible = true; grayed = false; touchable = true; onStage = true;
    displayObject = {visible: true, onMouseWheel: new Listener(), parent: null};
    x = 0; y = 0; width = 48; height = 48; data = null; packageItem = null; parent = null;
    onTouchBegin = new Listener(); onTouchMove = new Listener(); onTouchEnd = new Listener();
    onRollOver = new Listener(); onRollOut = new Listener();
    SetXY() {} SetSize() {} Dispose() {}
  }
  class GLoader extends Base { url = ''; onExternalLoadSuccess = new Listener(); onExternalLoadFailed = new Listener(); }
  class GButton extends Base { title = ''; icon = ''; selected = false; mode = 0; onChanged = new Listener(); GetChild() { return null; } }
  class GLabel extends Base { title = ''; icon = ''; GetChild() { return null; } }
  class GComponent extends Base { numChildren = 0; _transitions = []; GetChild() { return null; } GetController() { return null; } GetTransition() { return null; } }
  const fgui = {
    GComponent, GTextField: class extends Base {}, GRichTextField: class extends Base {}, GTextInput: class extends Base {},
    GButton, GLabel, GSlider: class extends Base {}, GComboBox: class extends Base {}, GMovieClip: class extends Base {},
    GTree: class extends Base {}, GImage: class extends Base {}, GLoader, GList: class extends Base {}, GProgressBar: class extends Base {}, GGraph: class extends Base {}
  };
  const adapter = createObjectAdapter(
    fgui,
    () => 0,
    p => p,
    () => ({}),
    {wheelDeltaX: () => 0, hitTest: () => null, buttonSound: () => '', transitionSettings: () => ({autoPlay: false, times: 1, delay: 0})},
    () => {}
  );
  assert.throws(() => { adapter.wrap(new GLoader()).url = 'icon://play'; }, e => e.code === 'LGUI-RT-072' && /Unity 后端不支持代码图标/.test(e.message));
  assert.throws(() => { adapter.wrap(new GButton()).icon = 'icon://play'; }, e => e.code === 'LGUI-RT-072');
  assert.throws(() => { adapter.wrap(new GLabel()).icon = 'icon://play'; }, e => e.code === 'LGUI-RT-072');

  // Unity 后端启动时遇到 app.icons 也报 LGUI-RT-072。
  const root = makeCodeIconProject();
  const base = await started({root});
  const fakeUnityBackend = {...base.backend, name: 'unity'};
  await assert.rejects(
    fw.boot(fakeUnityBackend, {backend: 'unity', icons: ICONS, start() {}}, fw.defaultConfig, base.deps, {wallBase: 1_700_000_000_000, texts: {'zh-CN': {'lgui.back': '返回', 'lgui.requestFailed': '失败', 'lgui.time.day': '{n}天', 'lgui.time.hour': '{n}时', 'lgui.time.minute': '{n}分', 'lgui.time.second': '{n}秒'}}}),
    e => e.code === 'LGUI-RT-072' && /Unity 后端不支持代码图标/.test(e.message)
  );
  fw.clearIcons();
});
