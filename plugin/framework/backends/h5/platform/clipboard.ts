// h5 的剪贴板：浏览器的 navigator.clipboard。只有安全的页面（https 或 localhost）有它；写入一般要在用户点击的处理里，
// 读取时浏览器可能先问用户。用不了、被拒绝时 Promise 失败，报 LGUI-RT-241（外部失败，交回给调用方）。
import type {ClipboardService} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';

const failed = (what: string, detail: string): LgRuntimeError =>
  new LgRuntimeError('LGUI-RT-241', `剪贴板${what}失败：${detail}`, '网页只有 https 或 localhost 的页面能用剪贴板；写入放在点击动作里直接调用（不要先 await 别的）；读取要用户在浏览器的提示里允许。');

const reason = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export function createH5Clipboard(): ClipboardService {
  const api = (): Clipboard | null => (typeof navigator !== 'undefined' && navigator.clipboard) || null;
  return {
    async writeText(text) {
      const clipboard = api();
      if (!clipboard) throw failed('写入', '这个页面不能用浏览器的剪贴板（navigator.clipboard 不存在）');
      try { await clipboard.writeText(text); } catch (error) { throw failed('写入', reason(error)); }
    },
    async readText() {
      const clipboard = api();
      if (!clipboard) throw failed('读取', '这个页面不能用浏览器的剪贴板（navigator.clipboard 不存在）');
      try { return await clipboard.readText(); } catch (error) { throw failed('读取', reason(error)); }
    }
  };
}
