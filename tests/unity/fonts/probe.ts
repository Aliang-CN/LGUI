// Unity 项目字体（TMP）的原生验收：在真 Unity 里跑适配层、FairyGUI 的 TMPFont 和 TMP。不是画面验收，截图另看。
// 由 prepare.mjs 打包成 Assets/LGUI/Resources/Game/game.js.txt；字体样本放在 Assets/LGUI/Resources/UI/fonts/Noto.otf（lgui unity export 写的位置）。
import {createUnityBackend} from '../../../plugin/framework/backends/unity/adapter/index';

declare const CS: {
  FairyGUI: {GTextField: new () => unknown; GRoot: {inst: {AddChild(child: unknown): void}}};
  LGUI: {
    Platform: {FallbackFontName: string; FallbackFontCandidates: string};
    Tests: {
      ConformanceBridge: {Complete(result: string): void};
      FontProbeMetrics: {RegisteredFont(name: string): string; DrawnWith(field: unknown): string; ServedBy(font: string, ch: string): string; Atlas(font: string): string; LayoutMs(field: unknown, text: string): number};
    };
  };
};

// 样本里有的字（tests/fixtures/fonts/README.md）；「齉」样本里没有，要由系统回退字体出
const IN_FONT = '开始游戏设置背包商店';
const NOT_IN_FONT = '齉';

const globals = globalThis as unknown as {__lguiStart?: () => Promise<void>};
globals.__lguiStart = async () => {
  const report: Record<string, unknown> = {probe: 'Unity TMP project fonts'};
  const metrics = CS.LGUI.Tests.FontProbeMetrics;
  try {
    // 1. 项目字体找不到：报 LGUI-RT-181（先跑：它在注册任何字体之前就停下）
    try {
      await createUnityBackend().init({projectName: 'font-probe', defaultFont: null, fonts: ['Missing'], uiBase: 'UI'});
      report.missing = {rejected: false};
    } catch (error) {
      const e = error as {code?: string; message?: string};
      report.missing = {rejected: true, code: e.code, message: e.message};
    }
    // 2. 注册成 TMP 字体，defaultFont 按名字找得到
    const backend = createUnityBackend();
    await backend.init({projectName: 'font-probe', defaultFont: 'Noto', fonts: ['Noto'], uiBase: 'UI'});
    report.registered = metrics.RegisteredFont('Noto');
    report.atlas = metrics.Atlas('Noto');
    report.fallbackName = CS.LGUI.Platform.FallbackFontName;
    report.fallbackCandidates = CS.LGUI.Platform.FallbackFontCandidates;
    // 3. 没写 font 的文字（用 defaultFont）实际用项目 TMP 字体画
    const field = new CS.FairyGUI.GTextField();
    CS.FairyGUI.GRoot.inst.AddChild(field);
    report.firstLayoutMs = metrics.LayoutMs(field, IN_FONT + NOT_IN_FONT);
    report.secondLayoutMs = metrics.LayoutMs(field, NOT_IN_FONT + IN_FONT);
    report.drawnWith = metrics.DrawnWith(field);
    // 4. 项目字体里有的字由它自己出；没有的字由系统回退字体出
    report.inFontServedBy = [...IN_FONT].map(ch => metrics.ServedBy('Noto', ch));
    report.notInFontServedBy = metrics.ServedBy('Noto', NOT_IN_FONT);
  } catch (error) { report.fatal = String((error as Error)?.stack ?? error); }
  CS.LGUI.Tests.ConformanceBridge.Complete(JSON.stringify(report));
};
