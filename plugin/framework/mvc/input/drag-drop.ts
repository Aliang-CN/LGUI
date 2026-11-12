// 拖放（游戏式）：原来的控件不动；拖起时框架在最上面放一个跟手的临时图标（不接收输入），松手就去掉；
// 松在写了 drop 的控件上就调用 drop(data)（ItemView 里再带上这一项的数据），松在别处什么也不改，Model 一变界面跟着重画。
// 落点由后端的命中测试决定（网页是浏览器自己的命中测试，headless 是模拟操作指到的控件）：只认激活界面里可用的控件，重叠时取最里面的。
import type {UIButton, UIComponent, UILabel, UILoader, UIObject} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {asActor} from '../actor';
import {runtime} from '../runtime';
import type {DragGesture} from '../types';
import type {BindContext} from '../binding/index';
import {watch} from '../binding/index';

interface DropTarget {
  object: UIObject;
  ctx: BindContext;
  drop: (data: unknown, item?: unknown) => unknown;
}

const targets = new Set<DropTarget>();

const fail = (code: string, message: string, next: string): never => { throw new LgRuntimeError(code, message, next); };

/** 登记一个落点（绑定表里的 drop），解绑时去掉。 */
export function dropTarget(object: UIObject, key: string, drop: unknown, ctx: BindContext): void {
  if (typeof drop !== 'function') fail('LGUI-RT-063', `${ctx.where} 的 ${key} 的 drop 不是函数。`, '写成 drop: data => xxxController.方法(data)。');
  const target: DropTarget = {object, ctx, drop: drop as DropTarget['drop']};
  targets.add(target);
  ctx.scope.add(() => { targets.delete(target); });
}

/** (x, y) 这一点上的落点：激活界面里、可用，命中的控件在它里面层数最少的那个。 */
function targetAt(x: number, y: number): DropTarget | null {
  let found: DropTarget | null = null;
  let best = Infinity;
  for (const t of targets) {
    // 先看松手的点在不在它上面，再看它能不能接：不相干的落点不去读它的状态（headless 读不了 gearLook 管的可用状态）。
    const depth = t.object.hitDepth(x, y);
    if (depth < 0 || depth >= best) continue;
    if (!t.ctx.isActive() || !t.object.enabled) continue;
    found = t;
    best = depth;
  }
  return found;
}

/** 跟手的图标：一个不接收输入的空容器放在根节点最上面，图片居中放在里面。包里的图片按原图尺寸，网络图片按来源控件的尺寸。 */
function createGhost(url: string, source: UIObject): UIComponent {
  const {backend} = runtime();
  const ghost = backend.createContainer('lgui-drag');
  ghost.touchable = false;
  const image = backend.createImage(url);
  image.touchable = false;
  const size = backend.imageSize(url) ?? source.rect;
  image.rect = {x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height};
  ghost.addChild(image);
  backend.root.addChild(ghost);
  return ghost;
}

/** 拖起的来源（绑定表里的 dragData、dragIcon）：返回交给手势识别的 drag 回调。canStart 为假时（界面没激活、控件不可用）拖不起来。 */
export function dragSource(object: UIObject, key: string, binding: Record<string, unknown>, ctx: BindContext, canStart: () => boolean): (gesture: DragGesture) => void {
  let data: unknown;
  watch<unknown>(binding.dragData, ctx, value => { data = value; });
  let icon: string | null = null;
  if ('dragIcon' in binding) watch<string>(binding.dragIcon, ctx, value => { icon = value; });
  else if (!('url' in object) && !('icon' in object)) {
    fail('LGUI-RT-220', `${ctx.where} 的 ${key} 写了 dragData，但它不是加载器、按钮或标签，拖起时没有图标可以显示。`, '加上 dragIcon: 图片地址（ItemView 里写成 it => …）；或者把 dragData 写在加载器、按钮、标签上。');
  }
  const iconOf = (): string => icon ?? ('url' in object ? (object as UILoader).url : (object as UIButton | UILabel).icon);
  let ghost: UIComponent | null = null;
  let carried: unknown;
  const removeGhost = (): void => { ghost?.dispose(); ghost = null; };
  ctx.scope.add(removeGhost); // 拖到一半界面关了：图标也去掉
  return gesture => {
    if (gesture.phase === 'start') {
      if (!canStart() || data === null || data === undefined) return; // 空格子（dragData 是 null）拖不起来
      carried = data;
      ghost = createGhost(iconOf(), object);
    }
    if (!ghost) return;
    if (gesture.phase !== 'end') { ghost.rect = {x: gesture.x, y: gesture.y, width: 0, height: 0}; return; }
    removeGhost();
    if (gesture.cancelled) return;
    const target = targetAt(gesture.x, gesture.y);
    if (target) asActor(target.ctx.owner, () => target.drop(carried, target.ctx.item?.data));
  };
}
