// 依次调用好几段用户代码（钩子、收听函数、订阅者）：一段出错不打断后面的，全部调完再把错误抛出来。

/** 收集一串调用里的错误。 */
export class ErrorList {
  private readonly errors: unknown[] = [];

  /** 调用 run；出错先记下，不往外抛。 */
  run(run: () => void): void {
    try { run(); } catch (error) { this.errors.push(error); }
  }

  /** 记下一个错误（可以直接当 onError 传）。 */
  readonly add = (error: unknown): void => { this.errors.push(error); };

  /** 有错误就抛出第一个；后面的作为未处理的 Promise 报出来，不悄悄吞掉。 */
  throwFirst(): void {
    if (this.errors.length === 0) return;
    const [first, ...rest] = this.errors.splice(0);
    for (const error of rest) void Promise.reject(error);
    throw first;
  }
}
