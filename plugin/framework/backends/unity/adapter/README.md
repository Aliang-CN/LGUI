# unity/adapter

Unity 后端的 TypeScript 适配层。`createUnityBackend()` 实现 `core/` 的控件和平台接口，由导出时生成的入口选择，游戏源码仍只 import `lgui`。

- `index.ts`：后端启动、包与固定文字翻译加载；资源根为 `UI`，翻译根为 `UI/i18n`。
- `objects.ts`：FairyGUI 控件（含标签、滑动条、下拉框、序列帧动画、树）、列表、控制器、动效和事件的包装。每个原生订阅都能取消，界面销毁与后端停止时释放。拖放落点用 FairyGUI 的命中测试，`shown` 看显示对象是否在舞台上、各级是否显示。
- `platform.ts`：通过 FairyGUI Stage 接收原始指针、键盘和滚轮，通过 Unity 包里的 `LGUI.Platform` 提供存储、屏幕、时间、声音（音效、背景音乐、暂停）和 HTTP，剪贴板直接读写 `UnityEngine.GUIUtility.systemCopyBuffer`（运行环境里没有时报 `LGUI-RT-241`）；默认日志出口和引擎的 `Logger` 同形，写到 Unity 控制台。WebSocket 尚未实现，调用时报 `LGUI-RT-001`。
- `native-*.ts`：固定版本 C# API 的严格类型边界。

Unity 包的 `LGUIBoot` 每帧调用 `__lguiFrame(deltaMs)`，前后台变化时调用 `__lguiVisibility(visible)`，销毁脚本环境前调用 `__lguiDispose()`。这些入口只在适配层内部使用。

每帧回调的异常记录为 `LGUI-RT-160` 并保留堆栈；同一帧其余回调和后续帧继续运行。它与 h5 一样不会因为单个界面的回调出错而停止全部定时器或请求超时。

开发验证工程与共用一致性用例的启动器在仓库的 `tests/unity/`；它们不随插件下发。编译、Editor Play 与 Windows IL2CPP Player 的验收应分别记录。
