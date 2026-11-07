// 换版（旋转、换语言）以后按栈的顺序重排层内的界面：只调整顺序，打开着的界面不离开舞台（不先移走再加回来）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkTexts, started} from '../../helpers/framework.mjs';

test('换版后重排：层内顺序和栈一致，别的打开着的界面没有被移出层', async () => {
  const {fw, ui} = await started({texts: {'zh-CN': {...frameworkTexts}, en: {...frameworkTexts}}});
  const {lgui, View} = fw;
  class Lower extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static bothOrientations = true; }
  class Upper extends View { static component = 'Common/CurrencyBar'; static layer = 'page'; }
  await lgui.ui.open(Lower);
  await lgui.ui.open(Upper);
  const page = ui.containers.get('page');
  // 只记 UIManager 自己调用的 removeChild（headless 的 addChild 移动已有的子对象时内部也会调用它，那不算离开层）。
  const removed = [];
  let adding = false;
  const add = page.addChild.bind(page);
  const remove = page.removeChild.bind(page);
  page.addChild = child => { adding = true; try { add(child); } finally { adding = false; } };
  page.removeChild = child => { if (!adding) removed.push(child); remove(child); };
  const upper = lgui.ui.get(Upper).__component;
  await lgui.setLanguage('en');   // 两个界面都重建（新组件后加进去），再按栈的顺序排
  const lower = lgui.ui.get(Lower).__component;
  const now = lgui.ui.get(Upper).__component;
  assert.notEqual(now, upper, '确实重建了');
  assert.deepEqual(removed.filter(c => c === lower || c === now), [], '重排时没有把打开着的界面移出层（销毁的旧组件不算）');
  const order = page.children.filter(c => c === lower || c === now);
  assert.deepEqual(order, [lower, now], '层内顺序和栈一致');
});
