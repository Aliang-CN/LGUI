import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from './cli/helpers.mjs';
import {sharp} from '../../plugin/tools/lib/vendor.mjs';

// 测试里现画的整页图：透明底，按 RGBA 一个个像素填。
function canvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, [r, g, b, a = 255]) => { if (x >= 0 && y >= 0 && x < width && y < height) data.set([r, g, b, a], (y * width + x) * 4); };
  return {
    width, height, data,
    rect(x0, y0, w, h, color) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, typeof color === 'function' ? color(x - x0, y - y0) : color); },
    // 圆：r 以内填色，外面 outline 宽的一圈深色描边，再外面 halo 宽的一圈半透明白边
    disc(cx, cy, r, fill, {outline = 0, halo = 0} = {}) {
      const R = r + outline + halo;
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) set(x, y, fill); else if (d <= r + outline) set(x, y, [30, 20, 10]); else if (d <= R) set(x, y, [255, 255, 255, 128]);
      }
    },
    save(file) { return sharp()(data, {raw: {width, height, channels: 4}}).png().toFile(file); }
  };
}

const read = async file => {
  const {data, info} = await sharp()(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height, at: (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)]};
};
// 不透明部分的外框宽高
const opaqueBox = img => {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.at(x, y)[3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return {width: x1 - x0 + 1, height: y1 - y0 + 1};
};

async function project() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-cut-'));
  await run(['init', 'g'], parent);
  return path.join(parent, 'g');
}
const cut = async (root, argv) => JSON.parse((await run(['art', 'cut', ...argv, '--json'], root)).stdout);

test('lgui art cut：物件跨格漂移也按透明区域找对，闪光并进旁边的物件，杂点丢掉，EMPTY 跳过，整页同一个缩放比例，去白边，出检查图，lgui check 通过', async () => {
  const root = await project();
  const page = canvas(600, 400);
  page.disc(100, 100, 74, [220, 40, 40], {outline: 6, halo: 2});   // big：外框 165，带白边
  page.disc(250, 120, 40, [40, 200, 40]);                           // small：比 big 偏下
  page.rect(305, 60, 10, 10, [255, 240, 120]);                      // small 右上的闪光碎片，离它 14 像素
  page.rect(550, 30, 3, 3, [0, 0, 0]);                              // 杂点
  page.rect(140, 250, 120, 120, [40, 40, 220]);                     // square：第二行，越过 x=200 的格线
  await page.save(path.join(root, 'page.png'));
  fs.writeFileSync(path.join(root, 'names.txt'), 'big=80x80\nsmall=80x80\nEMPTY\nsquare=60x60\n');
  const result = await cut(root, ['page.png', '--pkg', 'Main', '--names', 'names.txt']);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const {images, scale, specks, merged, sheet} = result.data;
  assert.deepEqual(images.map(i => i.name), ['big', 'small', 'square']);
  assert.deepEqual([specks, merged], [1, 1]);
  assert.equal(scale, Math.round(80 / 165 * 1000) / 1000, '缩放比例由最需要缩小的 big 决定');
  assert.deepEqual(images[1].source, {x: 210, y: 60, width: 105, height: 101}, 'small 的外框包括闪光');

  const big = await read(path.join(root, 'ui/assets/Main/big.png'));
  const small = await read(path.join(root, 'ui/assets/Main/small.png'));
  const square = await read(path.join(root, 'ui/assets/Main/square.png'));
  assert.deepEqual([big.width, big.height, small.width, small.height, square.width, square.height], [80, 80, 80, 80, 60, 60]);
  // 同一个缩放比例：small 不放大到 80，按 105×101 × 比例
  const box = opaqueBox(small);
  assert.ok(Math.abs(box.width - 105 * 80 / 165) <= 1.5 && Math.abs(box.height - 101 * 80 / 165) <= 1.5, JSON.stringify(box));
  assert.deepEqual(square.at(30, 30), [40, 40, 220, 255]);
  // 去白边：big 的半透明边缘只剩描边的深色
  const fringe = [];
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) { const [r, g, b, a] = big.at(x, y); if (a > 8 && a < 250) fringe.push((r + g + b) / 3); }
  assert.ok(fringe.length > 0 && Math.max(...fringe) < 80, `半透明边缘最亮 ${Math.max(...fringe)}`);

  const xml = fs.readFileSync(path.join(root, 'ui/assets/Main/package.xml'), 'utf8');
  assert.match(xml, /<image id="art00000" name="big\.png" path="\/" exported="true" width="80" height="80"\/>/);
  assert.match(xml, /<image id="art00002" name="square\.png" path="\/" exported="true" width="60" height="60"\/>/);
  assert.ok(fs.existsSync(path.join(root, 'ui/art-src/Main/page.png')));
  assert.equal(sheet, '.lgui/build/art/Main/page-sheet.png');
  const contact = await read(path.join(root, sheet));
  assert.deepEqual(contact.at(2, 2), [128, 128, 128, 255]);
  const check = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.equal(check.ok, true, JSON.stringify(check.errors));

  // 对照：关掉去白边，同一张图的边缘是亮的（说明上面的断言确实测到了白边）
  fs.copyFileSync(path.join(root, 'page.png'), path.join(root, 'page2.png'));
  const raw = await cut(root, ['page2.png', '--pkg', 'Main', '--names', 'big2=80x80,small2=80x80,square2=60x60', '--defringe', '0']);
  assert.equal(raw.ok, true, JSON.stringify(raw.errors));
  const big2 = await read(path.join(root, 'ui/assets/Main/big2.png'));
  let lightest = 0;
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) { const [r, g, b, a] = big2.at(x, y); if (a > 8 && a < 250) lightest = Math.max(lightest, (r + g + b) / 3); }
  assert.ok(lightest > 120, `不去白边时最亮 ${lightest}`);
});

test('lgui art cut：九宫格保留原图的拉伸区并写 scale9grid（LGUI-UI-015 通过），平铺图接缝检查通过并写 scale="tile"', async () => {
  const root = await project();
  const page = canvas(800, 320);
  // 按钮：AI 按 2 倍画的 400×120，左 60 红、中间绿、右 60 蓝
  page.rect(20, 20, 400, 120, (x) => (x < 60 ? [220, 40, 40] : x >= 340 ? [40, 40, 220] : [40, 200, 40]));
  // 面板：200×200，四边 40 黄框，中间紫
  page.rect(500, 20, 200, 200, (x, y) => (x < 40 || y < 40 || x >= 160 || y >= 160 ? [230, 200, 40] : [140, 40, 160]));
  // 平铺条：200×80，周期 20 的竖条纹，左右能接上
  page.rect(20, 220, 200, 80, (x) => (x % 20 < 10 ? [60, 50, 80] : [150, 140, 170]));
  await page.save(path.join(root, 'parts.png'));
  fs.writeFileSync(path.join(root, 'parts.txt'), 'btn=200x60 9grid=30,0,30,0\npanel=100x100 9grid=20,20,20,20\ntabBar=100x40 tile\n');
  const result = await cut(root, ['parts.png', '--pkg', 'Main', '--names', 'parts.txt']);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.data.scale, 0.5, '按钮和平铺条的高度定比例，九宫格的拉伸方向不参与');
  const [btn, panel, tabBar] = result.data.images;
  // 不抽成「两端 + 中间 1 像素」：整张按比例缩放，scale9grid 写中间那一块
  assert.deepEqual([btn.width, btn.height, btn.scale9grid], [200, 60, '30,0,140,60']);
  assert.deepEqual([panel.width, panel.height, panel.scale9grid], [100, 100, '20,20,60,60']);
  assert.deepEqual([tabBar.width, tabBar.height, tabBar.tile, tabBar.seam.ok], [100, 40, true, true]);
  const b = await read(path.join(root, 'ui/assets/Main/btn.png'));
  assert.deepEqual([b.at(10, 30), b.at(100, 30), b.at(190, 30)], [[220, 40, 40, 255], [40, 200, 40, 255], [40, 40, 220, 255]]);
  const p = await read(path.join(root, 'ui/assets/Main/panel.png'));
  assert.deepEqual([p.at(5, 5), p.at(50, 50), p.at(95, 95)], [[230, 200, 40, 255], [140, 40, 160, 255], [230, 200, 40, 255]]);
  const xml = fs.readFileSync(path.join(root, 'ui/assets/Main/package.xml'), 'utf8');
  assert.match(xml, /name="btn\.png" path="\/" exported="true" width="200" height="60" scale="9grid" scale9grid="30,0,140,60"\/>/);
  assert.match(xml, /name="panel\.png" path="\/" exported="true" width="100" height="100" scale="9grid" scale9grid="20,20,60,60"\/>/);
  assert.match(xml, /name="tabBar\.png" path="\/" exported="true" width="100" height="40" scale="tile"\/>/);
  const check = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  // 检查图里九宫格按导出尺寸拉开、平铺图并排两份
  const sheet = await read(path.join(root, result.data.sheet));
  assert.ok(sheet.width >= 1024 && sheet.height >= 100 + 16);
});

test('lgui art cut：物件数和名字数对不上报 LGUI-CLI-081 并列出找到的物件；平铺接不上报 LGUI-CLI-086；放不下报 LGUI-CLI-085；出错时什么都不写', async () => {
  const root = await project();
  const page = canvas(400, 200);
  page.rect(20, 20, 60, 60, [200, 0, 0]);
  page.rect(150, 30, 60, 60, [0, 200, 0]);
  page.rect(20, 120, 200, 40, (x) => [Math.round(x / 200 * 255), 60, 255 - Math.round(x / 200 * 255)]);  // 红到蓝的渐变，左右接不上
  await page.save(path.join(root, 'bad.png'));
  const xmlFile = path.join(root, 'ui/assets/Main/package.xml');
  const before = fs.readFileSync(xmlFile, 'utf8');

  const mismatch = await cut(root, ['bad.png', '--pkg', 'Main', '--names', 'a=60x60,b=60x60', '--size', '60x60']);
  assert.equal(mismatch.errors[0].code, 'LGUI-CLI-081');
  assert.match(mismatch.errors[0].message, /找到 3 个物件，但名字有 2 个/);
  assert.match(mismatch.errors[0].message, /20,20 60×60.*150,30 60×60.*20,120 200×40/);

  fs.writeFileSync(path.join(root, 'bad.txt'), 'a=30x30\nb=30x30\nstrip=100x20 tile\n');
  const seam = await cut(root, ['bad.png', '--pkg', 'Main', '--names', 'bad.txt']);
  assert.deepEqual(seam.errors.map(e => e.code), ['LGUI-CLI-086']);

  const tooBig = await cut(root, ['bad.png', '--pkg', 'Main', '--names', 'a,b,c', '--size', '30x30', '--scale', '1']);
  assert.ok(tooBig.errors.length === 3 && tooBig.errors.every(e => e.code === 'LGUI-CLI-085'), JSON.stringify(tooBig.errors));

  const inline9 = await cut(root, ['bad.png', '--pkg', 'Main', '--names', 'a=30x30 9grid=4,0,4,0']);
  assert.equal(inline9.errors[0].code, 'LGUI-CLI-080');
  fs.writeFileSync(path.join(root, 'grids.txt'), 'a=30x30 9grid=4,4,4,4\nb=30x30 9grid=4,4,4,4\nc=100x20 9grid=4,4,4,4\n');
  const noScale = await cut(root, ['bad.png', '--pkg', 'Main', '--names', 'grids.txt']);
  assert.equal(noScale.errors[0].code, 'LGUI-CLI-085');

  assert.equal(fs.readFileSync(xmlFile, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(root, 'ui/assets/Main/a.png')) && !fs.existsSync(path.join(root, 'ui/art-src/Main/bad.png')));
});

test('lgui art cut：一页图分给两个包（pkg=），各包各自登记、各自取 ID；fit 的九宫格单独缩放到正好等于尺寸，其余照用整页比例；包不存在报 LGUI-CLI-083', async () => {
  const root = await project();
  const page = canvas(800, 300);
  page.rect(20, 20, 100, 100, [200, 0, 0]);    // iconA → Main，50×50，决定整页比例 0.5
  page.rect(200, 20, 80, 80, [0, 200, 0]);     // iconB → Common，按整页比例出 40×40
  page.rect(20, 150, 300, 100, (x) => (x < 35 ? [220, 40, 40] : x >= 265 ? [40, 40, 220] : [40, 200, 40]));  // btnLarge → Common，fit
  await page.save(path.join(root, 'mixed.png'));
  const commonXml = path.join(root, 'ui/assets/Common/package.xml');
  const commonBefore = fs.readFileSync(commonXml, 'utf8');

  fs.writeFileSync(path.join(root, 'nope.txt'), 'iconA=50x50\niconB=50x50 pkg=Nope\nbtnLarge=547x186 9grid=64,0,64,0 fit pkg=Common\n');
  const nope = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'nope.txt']);
  assert.deepEqual(nope.errors.map(e => e.code), ['LGUI-CLI-083']);
  assert.match(nope.errors[0].message, /ui\/assets\/Nope\/package\.xml/);
  fs.writeFileSync(path.join(root, 'bad-fit.txt'), 'iconA=50x50 fit\n');
  assert.equal((await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'bad-fit.txt'])).errors[0].code, 'LGUI-CLI-080');

  fs.writeFileSync(path.join(root, 'mixed.txt'), 'iconA=50x50\niconB=50x50 pkg=Common\nbtnLarge=547x186 9grid=64,0,64,0 fit pkg=Common\n');
  const result = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'mixed.txt']);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.data.scale, 0.5, 'fit 的项不参与整页比例');
  const [a, b, btn] = result.data.images;
  assert.deepEqual([a.package, a.file, a.scale], ['Main', 'ui/assets/Main/iconA.png', 0.5]);
  assert.deepEqual([b.package, b.file, b.url, b.scale], ['Common', 'ui/assets/Common/iconB.png', 'ui://Common/iconB', 0.5]);
  assert.deepEqual([btn.package, btn.width, btn.height, btn.scale9grid, btn.scale], ['Common', 558, 186, '64,0,430,186', 1.86]);
  assert.deepEqual(opaqueBox(await read(path.join(root, 'ui/assets/Common/iconB.png'))), {width: 40, height: 40});
  const btnImg = await read(path.join(root, 'ui/assets/Common/btnLarge.png'));
  assert.deepEqual([btnImg.at(10, 93), btnImg.at(279, 93), btnImg.at(540, 93)], [[220, 40, 40, 255], [40, 200, 40, 255], [40, 40, 220, 255]]);
  assert.deepEqual([btnImg.at(279, 0)[3], btnImg.at(279, 185)[3]], [255, 255], '固定方向正好 186 高，上下没有留空');

  const main = fs.readFileSync(path.join(root, 'ui/assets/Main/package.xml'), 'utf8');
  const common = fs.readFileSync(commonXml, 'utf8');
  assert.match(main, /<image id="art00000" name="iconA\.png" path="\/" exported="true" width="50" height="50"\/>/);
  assert.ok(!main.includes('iconB') && !main.includes('btnLarge'));
  assert.match(common, /<image id="art00000" name="iconB\.png" path="\/" exported="true" width="50" height="50"\/>/);
  assert.match(common, /<image id="art00001" name="btnLarge\.png" path="\/" exported="true" width="558" height="186" scale="9grid" scale9grid="64,0,430,186"\/>/);
  assert.notEqual(common, commonBefore);
  assert.ok(fs.existsSync(path.join(root, 'ui/art-src/Main/mixed.png')) && !fs.existsSync(path.join(root, 'ui/art-src/Common')));
  const check = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('lgui art cut：包里已经登记的同名图片直接替换，资源 ID、路径、导出不变（组件引用不断）；原来登记的平铺照样平铺；没登记的同名文件报 LGUI-CLI-082', async () => {
  const root = await project();
  const main = path.join(root, 'ui/assets/Main');
  fs.mkdirSync(path.join(main, 'icons'));
  await canvas(10, 10).save(path.join(main, 'icons/hero.png'));
  await canvas(10, 10).save(path.join(main, 'strip.png'));
  const xmlFile = path.join(main, 'package.xml');
  fs.writeFileSync(xmlFile, fs.readFileSync(xmlFile, 'utf8').replace('</resources>', '  <image id="hero0001" name="hero.png" path="/icons/" exported="true" width="10" height="10"/>\n    <image id="strip001" name="strip.png" path="/" exported="true" width="10" height="10" scale="tile"/>\n  </resources>'));
  for (const file of ['MainView.xml', 'MainView@portrait.xml']) {
    const xml = path.join(main, file);
    fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace('</displayList>', '  <image id="n9" name="hero" src="hero0001" xy="0,0" size="50,50"/>\n  </displayList>'));
  }
  const page = canvas(400, 200);
  page.rect(20, 20, 100, 100, [200, 0, 0]);                                       // hero → 50×50
  page.rect(150, 40, 200, 40, (x) => (x % 20 < 10 ? [60, 50, 80] : [150, 140, 170]));  // strip，名字文件没写 tile
  await page.save(path.join(root, 'new.png'));
  fs.writeFileSync(path.join(root, 'new.txt'), 'hero=50x50\nstrip=100x20\n');
  const result = await cut(root, ['new.png', '--pkg', 'Main', '--names', 'new.txt']);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const [hero, strip] = result.data.images;
  assert.deepEqual([hero.id, hero.file, hero.replaced, strip.id, strip.tile, strip.replaced], ['hero0001', 'ui/assets/Main/icons/hero.png', true, 'strip001', true, true]);
  assert.deepEqual(result.data.inheritedTile, ['strip']);
  const xml = fs.readFileSync(xmlFile, 'utf8');
  assert.match(xml, /<image id="hero0001" name="hero\.png" path="\/icons\/" exported="true" width="50" height="50"\/>/);
  assert.match(xml, /<image id="strip001" name="strip\.png" path="\/" exported="true" width="100" height="20" scale="tile"\/>/);
  assert.ok(!/art0000/.test(xml), '没有另起新 ID');
  assert.ok(!fs.existsSync(path.join(main, 'hero.png')), '写到原来登记的路径');
  assert.deepEqual((await read(path.join(main, 'icons/hero.png'))).at(25, 25), [200, 0, 0, 255]);
  const check = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.equal(check.ok, true, JSON.stringify(check.errors));

  // 包目录里有同名文件、但没登记：不知道是哪张，不覆盖
  await canvas(10, 10).save(path.join(main, 'loose.png'));
  const stray = await cut(root, ['new.png', '--pkg', 'Main', '--names', 'loose=50x50,other=100x20']);
  assert.equal(stray.errors[0].code, 'LGUI-CLI-082');
  assert.match(stray.errors[0].message, /ui\/assets\/Main\/loose\.png/);
});

test('lgui art cut：原来登记成九宫格、名字文件没写 9grid 报 LGUI-CLI-112；整页比例下有物件缩得不到尺寸的一半报 LGUI-CLI-111；出错时什么都不写', async () => {
  const root = await project();
  const main = path.join(root, 'ui/assets/Main');
  const xmlFile = path.join(main, 'package.xml');
  await canvas(10, 10).save(path.join(main, 'frame.png'));
  fs.writeFileSync(xmlFile, fs.readFileSync(xmlFile, 'utf8').replace('</resources>', '  <image id="frame001" name="frame.png" path="/" exported="true" width="10" height="10" scale="9grid" scale9grid="2,2,6,6"/>\n  </resources>'));
  const before = fs.readFileSync(xmlFile, 'utf8');
  const page = canvas(400, 300);
  page.rect(20, 20, 200, 200, [200, 0, 0]);   // big：200 → 100，决定整页比例 0.5
  page.rect(300, 20, 20, 20, [0, 200, 0]);    // small：20 → 10，尺寸却是 100×100
  await page.save(path.join(root, 'mixed.png'));

  const grid = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'frame=100x100,small=100x100']);
  assert.deepEqual(grid.errors.map(e => e.code), ['LGUI-CLI-112']);
  assert.match(grid.errors[0].message, /Main\/frame 原来登记成九宫格（scale9grid="2,2,6,6"）/);

  const tiny = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'big=100x100,small=100x100']);
  assert.deepEqual(tiny.errors.map(e => e.code), ['LGUI-CLI-111']);
  assert.match(tiny.errors[0].message, /small 按整页比例 0\.5（由 big 决定）缩放后只有 10×10，不到尺寸 100×100 的一半/);
  const fixed = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'big=100x100,small=100x100', '--scale', '0.4']);
  assert.deepEqual(fixed.errors.map(e => e.code), ['LGUI-CLI-111']);
  assert.match(fixed.errors[0].message, /按--scale 0\.4缩放后/);
  // 尺寸写对了就能拆
  const ok = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'big=100x100,small=10x10']);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  fs.writeFileSync(xmlFile, before);
  for (const name of ['big', 'small']) fs.rmSync(path.join(main, `${name}.png`));
  fs.rmSync(path.join(root, 'ui/art-src'), {recursive: true});
  const again = await cut(root, ['mixed.png', '--pkg', 'Main', '--names', 'big=100x100,small=100x100']);
  assert.equal(again.errors[0].code, 'LGUI-CLI-111');
  assert.equal(fs.readFileSync(xmlFile, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(main, 'big.png')) && !fs.existsSync(path.join(root, 'ui/art-src/Main/mixed.png')));
});
