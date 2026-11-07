// 切换语言的协调（lgui.setLanguage 用）。后端换语言时要卸掉已加载的界面包、再按新语言装回来，中间有一段包不在的空窗。
// - 同时调用几次 setLanguage：按调用顺序一个一个切，不交叠。
// - 空窗里：已打开界面的绑定先不刷新（记下来，最后只按当时的数据刷一次），打开新界面、换横竖版等切换完成再做。
//   切换成功时这些界面会重建并按当前数据重新绑定，记下来的刷新落在已经换掉的组件上就不做了；切换失败时照原样刷新。

let queue: Promise<unknown> = Promise.resolve();
let holding = false;
// 开始过几次切换：拿着组件等的一方（排队的 modal 取了缓存组件）靠它知道中间换过语言。
let switches = 0;
let settled: Promise<void> | null = null;
// 空窗里要做的刷新：同一个刷新只记一次（到时候按当时的数据做）；alive 为假（组件已经换掉、界面已经关了）就不做了。
const deferred = new Map<() => void, () => boolean>();

/** 内部用：现在是不是在换包的空窗里（绑定先不刷新）。 */
export function updatesHeld(): boolean { return holding; }

/** 内部用：空窗里先记下一次刷新，切换结束时再做。 */
export function later(run: () => void, alive: () => boolean = () => true): void { deferred.set(run, alive); }

/** 内部用：开始过几次语言切换。前后两次不一样，说明中间换过包，之前建的组件是旧语言的。 */
export function languageSwitches(): number { return switches; }

/** 内部用：是不是有语言正在切换（从开始换包到重建完）。 */
export function languageSwitching(): boolean { return settled !== null; }

/** 内部用：等到没有语言在切换（切换中就等它完成，包括紧接着排在后面的）。 */
export async function languageSettled(): Promise<void> {
  while (settled) await settled;
}

function flush(): unknown[] {
  const errors: unknown[] = [];
  const entries = [...deferred];
  deferred.clear();
  for (const [run, alive] of entries) {
    if (!alive()) continue;
    try { run(); } catch (error) { errors.push(error); }
  }
  return errors;
}

/** 内部用：排队切换一次语言。swap 是后端换包（空窗），rebuild 在 swap 成功后重建已打开的界面。错误交回给这一次的调用方。 */
export function switchLanguage(swap: () => Promise<void>, rebuild: () => void): Promise<void> {
  const task = queue.then(async () => {
    let finish = (): void => {};
    settled = new Promise(resolve => { finish = resolve; });
    switches++;
    holding = true;
    const errors: unknown[] = [];
    try {
      try { await swap(); } catch (error) { errors.push(error); }
      holding = false;
      if (!errors.length) rebuild();
    } catch (error) {
      errors.push(error);
    } finally {
      holding = false;
      errors.push(...flush());
      settled = null;
      finish();
    }
    // 第一个错误交给调用方；同时还有别的错误时照常报出来（未处理的 Promise），不吞掉。
    const [first, ...rest] = errors;
    for (const error of rest) void Promise.reject(error);
    if (errors.length) throw first;
  });
  queue = task.catch(() => {});
  return task;
}
