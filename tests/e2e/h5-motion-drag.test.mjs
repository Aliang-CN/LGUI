// h5：动效（自动播放的 done、play 的 done、被盖住时暂停）和拖放（跟手的图标、松在 drop 上才改数据），用真实的浏览器和鼠标。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture, bagPanel} from '../helpers/fixture.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {generateWeb, generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));

// pulse：12 帧 = 500 毫秒；enter：自动播放，6 帧 = 250 毫秒。trash 放在最上面，接收拖放。
const motion = `  <transition name="pulse">
    <item time="0" type="Alpha" target="n0" tween="true" startValue="1" endValue="0.5" duration="12"/>
  </transition>
  <transition name="enter" autoPlay="true">
    <item time="0" type="Alpha" target="n0" tween="true" startValue="0" endValue="1" duration="6"/>
  </transition>
`;
const trash = '<component id="n5" name="trash" src="btn00001" xy="1000,300" size="160,56"><Button title="x"/></component>';
const panel = size => bagPanel({size, extra: trash}).replace(/<\/component>\s*$/, `${motion}</component>\n`);

test('h5：动效放完才 done、被盖住时暂停；拖放时有跟手的图标，松在 drop 上才改数据', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    const root = writeFixture(undefined, {landscape: panel('1920,1080'), portrait: panel('1080,1920')});
    await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
    const {deps} = await generateProjectTypes(root);
    const entry = path.join(root, 'entry.ts');
    const f = rel => JSON.stringify(path.join(fw, rel));
    fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
import {boot} from ${f('mvc/boot.ts')};
import {defaultConfig} from ${f('mvc/runtime.ts')};
import {lgui, View, ItemView, pick} from ${f('index.ts')};
import {Timers} from ${f('backends/h5/vendor/fairygui.module.js')};
const fx = lgui.Model({hits: 0, items: [{id: 'a', url: 'ui://Bag/flag'}, {id: 'b', url: 'ui://Bag/flag'}], sold: [] as string[]});
const done: {name: string; at: number}[] = [];
const record = (name: string) => done.push({name, at: performance.now()});
class SlotView extends ItemView<any, any> { static component = 'Bag/ItemSlot'; bind = {icon: {icon: (it: any) => it.url, dragData: (it: any) => it.id}}; }
class BagView extends View<any> { static component = 'Bag/BagPanel'; static layer = 'page' as const; static fullScreen = true; static bothOrientations = true;
  bind = {
    pulse: {play: pick(fx, s => s.hits), done: () => record('pulse')},
    enter: {done: () => record('enter')},
    list: {items: pick(fx, s => s.items), item: SlotView, key: (it: any) => it.id},
    trash: {drop: (id: string) => fx.set({items: fx.get().items.filter(x => x.id !== id), sold: [...fx.get().sold, id]})}
  }; }
class CoverView extends View<any> { static component = 'Common/Loading'; static layer = 'popup' as const; static fullScreen = true; static bothOrientations = true; }
// 动效的时钟按帧走：每一帧加上离上一帧过了多久，play() 之后的第一帧也把 play() 之前、从上一帧起的那段算进去。
// 所以「从什么时候算起」取上一帧的时刻（Timers.time），不取 play() 时的 performance.now()：机器忙、play() 前很久没出帧时，
// 后者晚于动效真正开始计时的时刻，量出来就比动效短。
const clock = () => Timers.time;
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'demo', defaultFont: null, uiBase: '/ui'});
  await boot(backend, {backend: 'h5', start() {}}, defaultConfig, ${JSON.stringify(deps)}, {language: 'zh-CN', texts: {'zh-CN': {'lgui.back': '返回', 'lgui.requestFailed': '请求失败（{code}）'}}});
  const opened = clock();
  const view = await lgui.ui.open(BagView);
  const c = (view as any).__component;
  const box = (o: any) => { const r = o.native.element.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; };
  Object.assign(window, {
    opened,
    clock,
    state: () => ({done: done.map(d => ({name: d.name, at: Math.round(d.at)})), sold: fx.get().sold, items: c.child('list').numItems, ghost: backend.root.childNames().includes('lgui-drag')}),
    play: () => { const at = clock(); fx.set({hits: fx.get().hits + 1}); return at; },
    cover: async (on: boolean) => { const at = clock(); if (on) await lgui.ui.open(CoverView); else lgui.ui.close(CoverView); return at; },
    centers: () => ({slot: box(c.child('list').itemAt(0).child('icon')), trash: box(c.child('trash')), empty: {x: 900, y: 600}}),
    ready: true
  });
})().catch(e => { (window as any).failure = String(e); });`);
    await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><script type="module" src="/app.js"></script>');
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 20000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      const state = () => page.evaluate(() => window.state());
      const doneOf = async name => (await state()).done.filter(d => d.name === name);

      // 自动播放的 enter：放完（约 250 毫秒）才 done
      await page.waitForFunction(() => window.state().done.some(d => d.name === 'enter'), null, {timeout: 5000});
      const opened = await page.evaluate(() => window.opened);
      assert.ok((await doneOf('enter'))[0].at - opened >= 200, '自动播放放完才通知');

      // play：值变一次播一次，约 500 毫秒后 done
      const started = await page.evaluate(() => window.play());
      await page.waitForFunction(() => window.state().done.some(d => d.name === 'pulse'), null, {timeout: 5000});
      assert.ok((await doneOf('pulse'))[0].at - started >= 450, '放完才通知');

      // 被盖住时暂停：播了马上盖住，盖着的 1.2 秒里不会放完；露出来以后再放完剩下的。
      // 播和盖在同一次调用里做：分两次调用时，机器忙的话两次之间动效已经走了一段，剩下的就不到 250 毫秒了
      // 盖着时等动效的时钟走过 1.2 秒（不按墙上时间：机器忙时一段时间里可能一帧都没出，那样就什么也没验）
      const covered = await page.evaluate(async () => { window.play(); return window.cover(true); });
      await page.waitForFunction(at => window.clock() - at >= 1200, covered, {timeout: 10000});
      assert.equal((await doneOf('pulse')).length, 1, '盖住时不走');
      const revealed = await page.evaluate(() => window.cover(false));
      await page.waitForFunction(() => window.state().done.filter(d => d.name === 'pulse').length === 2, null, {timeout: 5000});
      assert.ok((await doneOf('pulse'))[1].at - revealed >= 250, '露出来以后接着放剩下的');

      // 拖放：从第一格拖到 trash 上松手 → 数据改了，格子按数据重画；拖的途中有跟手的图标，松手就没了
      const drag = async (from, to) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {steps: 8});
        const ghost = (await state()).ghost;
        await page.mouse.move(to.x, to.y, {steps: 8});
        await page.mouse.up();
        await page.waitForTimeout(100);
        return ghost;
      };
      let centers = await page.evaluate(() => window.centers());
      assert.equal(await drag(centers.slot, centers.trash), true, '拖的途中有图标');
      assert.deepEqual(await state().then(s => [s.sold, s.items, s.ghost]), [['a'], 1, false]);
      // 松在空白处：什么也不改
      centers = await page.evaluate(() => window.centers());
      await drag(centers.slot, {x: centers.empty.x, y: centers.empty.y});
      assert.deepEqual(await state().then(s => [s.sold, s.items, s.ghost]), [['a'], 1, false]);
      assert.deepEqual(errors, []);
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }
});
