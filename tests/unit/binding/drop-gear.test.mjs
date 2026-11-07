// 拖放找落点：先看松手的点在不在这个落点上，再读它可不可用。headless 读不了 gearLook 管的「可用」（LGUI-RT-260），
// 松在别的落点上、或者松在空白处时，不能因为界面里有一个带 gearLook 的落点就报错。
import test from 'node:test';
import assert from 'node:assert/strict';
import {bagPanel, writeFixture} from '../../helpers/fixture.mjs';
import {started} from '../../helpers/framework.mjs';

// lookBin：带 gearLook（可用由控制器 tabs 决定）的落点；sellButton：普通落点。
const extra = '<component id="n30" name="lookBin" src="btn00001" xy="1200,300" size="160,56"><Button title="x"/><gearLook controller="tabs" pages="1" values="1,0,1,0" default="1,0,0,1"/></component>';

test('界面里有带 gearLook 的落点：松在别的落点上照常调用 drop，松在空白处什么也不做，都不报 LGUI-RT-260', async () => {
  const root = writeFixture(undefined, {landscape: bagPanel({extra}), portrait: bagPanel({size: '1080,1920', extra})});
  const {fw, backend, sim} = await started({root});
  const {lgui, View, ItemView} = fw;
  const log = [];
  class SlotView extends ItemView { static component = 'Bag/ItemSlot'; bind = {icon: {icon: 'ui://Bag/flag', dragData: 'a'}}; }
  class BagView extends View {
    static component = 'Bag/BagPanel'; static layer = 'page';
    bind = {list: {items: [1], item: SlotView}, sellButton: {drop: id => log.push(`sell ${id}`)}, lookBin: {drop: id => log.push(`bin ${id}`)}};
  }
  const view = await lgui.ui.open(BagView);
  const c = view.__component;
  assert.throws(() => c.child('lookBin').enabled, e => e.code === 'LGUI-RT-260', '前提：headless 读不了这个落点的可用状态');
  const icon = c.child('list').itemAt(0).child('icon');
  await sim.dragTo(backend, icon, c.child('sellButton'));
  await sim.drag(backend, icon, 5, 5);
  assert.deepEqual(log, ['sell a']);
});
