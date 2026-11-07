// 补丁 10：界面离开舞台时动效暂停，回到舞台接着放。
// 上游 Transition.onOwnerRemovedFromStage 把在放的动效 stop(false)：停在当前帧，不跳到结束；回到舞台时只重新放自动播放的。
// 还开着的界面也会离开舞台再回来（UIManager 换版后重排层内顺序、控制器的显示齿轮把它藏起来又显示），于是代码放的动效
// 停在半路（飞了一半的金币留在原地），循环动效停了也不恢复（绑定记着「在放」，不会重放）。这和 LGUI 的约定（被盖住时暂停、
// 露出来接着放，关闭时由框架停掉，组件销毁时一起销毁）不一致。
// 改成：离开舞台时把在放、没暂停的动效暂停并记下；回到舞台时恢复记下的，再走上游的逻辑（没在放的自动播放动效照样从头放）。
// ui/ 里显式写了「离开舞台不自动停止」（options 2）或「停止时跳到结束」（options 4）的，照上游的做。
import * as fgui from '../vendor/fairygui.module.js';
import {around, field, missing} from './hook';

const PATCH = 10;
const AUTO_STOP_DISABLED = 2;
const AUTO_STOP_AT_END = 4;

type StageTransition = fgui.Transition & {_options?: number; _paused?: boolean};
/** 不在构造函数里设的字段：[上游设它的方法, 字段]。_options 是读包时 setup() 设的，_paused 由 setPaused() 设。 */
export const transitionAssigned = [['setup', '_options'], ['setPaused', '_paused']] as const;
/** 离开舞台时由这里暂停的动效。 */
const pausedByStage = new WeakSet<fgui.Transition>();

export function installTransitionStage(): void {
  const proto = fgui.Transition.prototype;
  const removed: unknown = Reflect.get(proto, 'onOwnerRemovedFromStage');
  if (typeof removed !== 'function') throw missing(PATCH, 'Transition.onOwnerRemovedFromStage()');
  const original = removed as (this: StageTransition) => void;
  Reflect.set(proto, 'onOwnerRemovedFromStage', function (this: StageTransition): void {
    const options = field<number | undefined>(this, '_options') ?? 0;
    if ((options & (AUTO_STOP_DISABLED | AUTO_STOP_AT_END)) !== 0 || !this.playing) { original.call(this); return; }
    if (field<boolean | undefined>(this, '_paused')) return; // 已经暂停（比如界面被盖住），由暂停它的一方恢复
    this.setPaused(true);
    pausedByStage.add(this);
  });
  around<StageTransition, void>(PATCH, proto, 'Transition', 'onOwnerAddedToStage', transition => {
    if (!pausedByStage.has(transition)) return;
    pausedByStage.delete(transition);
    transition.setPaused(false);
  }, () => undefined);
}
