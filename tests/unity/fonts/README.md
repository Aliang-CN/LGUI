# Unity 项目字体（TMP）原生验收

在真 Unity 里跑 Unity 适配层、`LGUI.Platform.RegisterFont`、FairyGUI 的 `TMPFont` 和 TextMesh Pro。检查：

- 项目字体找不到时报 `LGUI-RT-181`（报错里有 `Resources/UI/fonts/Missing`）。
- 项目字体按名字注册成 FairyGUI 的 `TMPFont`，TMP 字体是动态图集（`Dynamic`），开了多图集。
- 没写 `font` 的文字（按 `defaultFont`）实际用项目 TMP 字体画（读 FairyGUI `TextField` 的 `_font`）。
- 项目字体里有的字由它自己出；项目字体里没有的字（`齉`，测试样本里故意没有）由系统回退字体出。这台机器上要找得到系统回退字体（候选见 `plugin/framework/backends/unity/package/Runtime/Platform/Fonts.cs`）。
- 记下第一次排版（字现画进图集）和第二次（已在图集里）的毫秒数：编辑器里只是参考，真机数字要在手机上跑。

`LGUI-RT-182`（一个系统字体都没找到）在有系统字体的机器上触发不了，由 `tests/unit/unity/objects.test.mjs` 用模拟的 Unity 桥测。

字体样本是 `tests/fixtures/fonts/NotoSansSC-Sample.otf`，`prepare.mjs` 把它放到 `lgui unity export` 写的位置（`Assets/LGUI/Resources/UI/fonts/Noto.otf`）。

```text
node tests/unity/fonts/prepare.mjs --project <Unity工程> --evidence <证据目录>
<Unity> -batchmode -projectPath <Unity工程> -executeMethod LGUI.Tests.LGUIConformanceEditor.Run -lguiResult <证据目录>/result.json -lguiTimeout 120 -logFile <证据目录>/unity.log
node tests/unity/fonts/checker.mjs <证据目录>/result.json
```

`<Unity工程>` 用 `../runner.mjs` 准备的开发工程（装好本地 PuerTS 3.0.3 Core/V8 和这个分支的 Unity 包，见上一级 README）。

## Unity 上要跑的步骤（这个 PR 在本机没跑，交给装了 Unity 6000.6 的机器）

1. **编译。** 用 `../runner.mjs` 准备一个新的开发工程（Unity 6000.6.6f1，这个分支的 `plugin/framework/backends/unity/package`）。打开以后 Console 里不能有编译错误。重点看：
   - `FairyGUI` 程序集带上 `FAIRYGUI_TMPRO` 以后能编过（`Extensions/TextMeshPro/TMPFont.cs`、`TMPTextFormat.cs`）。
   - `LGUI.Runtime` 的 `Platform/Fonts.cs` 能编过。

   编不过就把完整报错带回来。
2. **TMP 字体的原生验收。** 跑上面三条命令，`checker.mjs` 要输出 `ok: true`。把 `result.json`、`unity.log` 带回来；其中 `fallback` 是这台机器找到的系统字体（Windows 上应该是 `Microsoft YaHei`），`firstLayoutMs` / `secondLayoutMs` 也要记下。
3. **导出场景看画面。**
   - 在背包示例（`examples/inventory`）的副本里放 `ui/fonts/NotoSansSC.otf`：用整包 Noto Sans SC（`node -e "import('./scripts/fonts/noto.mjs').then(m => m.notoSansSC()).then(console.log)"` 下载到临时目录并打印路径，来源和 SHA-256 写在 `scripts/fonts/noto.mjs`）；把 `.lgui/project.json` 的 `defaultFont` 改成 `"NotoSansSC"`。
   - 用 `../export-play.mjs` 的流程导出并进入 Play，截图。
   - 看：文字清晰（SDF，不是糊的或方块）；`bold="true"`、描边（`strokeColor`）、投影（`shadowColor`）都在；`autoSize="shrink"` 的字能缩。
   - 再在运行时给一个文字控件设一段带生僻字和英文的玩家名，看生僻字由系统字体显示（不是方框）。
4. **出包（IL2CPP Windows Player）。**
   - 用 `../player-build.mjs` 的流程出一个 Player，看文字和投影跟编辑器里一样。这一步验证 `Runtime/Resources/LGUI/` 里的两份材质：它们让出包时带上 FairyGUI 的 TMP shader 和投影的 `UNDERLAY_ON` 变体。
   - 如果文字变成粗糙的方块或没有投影，说明 shader 或变体被剥掉了，把 Player 日志带回来。
   - 两份材质是手写的 YAML。Unity 打开后如果改写了它们（`git diff` 能看出），把改写后的文件带回来。
5. **手机（有条件再做）。** Android、iOS 真机上看：
   - 系统回退字体找得到：日志里没有 `LGUI-RT-182`，生僻字不是方框。
   - 一次显示几百个新字的界面，第一次打开的耗时（`firstLayoutMs` 这类数字，或者帧耗时）。
