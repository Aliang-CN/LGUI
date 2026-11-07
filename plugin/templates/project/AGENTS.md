# 这是一个 LGUI 工程

LGUI 是面向 AI Agent 的 UI 框架：界面在 `ui/`（FairyGUI 格式）里拼，功能用 TypeScript 按 MVC 写，网页上预览，以后可以导出到 Unity。下面的 `lgui` 指 `node <LGUI 插件目录>/tools/lgui.mjs`。

## 目录分工

| 目录 | 放什么 | 谁改 |
|---|---|---|
| `ui/` | 界面：组件 XML、图片；`ui/art-src/` 放 AI 生成的原始大图 | 你 |
| `src/` | 游戏代码：`main.ts` 入口，`modules/<功能>/` 下放 Model、View、Controller、Service | 你 |
| `tests/` | 测试，用 headless 后端在 Node 里跑 | 你 |
| `i18n/` | 文本表，每种语言一个 `<语言>.json` | 你 |
| `.lgui/` | LGUI 自己的东西：工程配置、框架副本、生成物 | 不要手改（`project.json` 除外） |

## 常用命令

| 命令 | 作用 |
|---|---|
| `lgui dev` | 打开网页预览，改动后自动刷新 |
| `lgui check` | 类型检查和规范检查 |
| `lgui test [文件或目录] [--name 名字] [--browser]` | 跑 `tests/` 里的测试（默认 headless；`--browser` 在真浏览器里跑） |
| `lgui verify` | 按标准尺寸横竖截图（同一个画面只截一次，按尺寸模拟刘海） |
| `lgui ui list` | 列出 `ui/` 里的组件和控件 |
| `lgui new module <名字> [--pattern <模式>]` | 生成一个功能的骨架（带模式时连横竖两版界面一起生成） |
| `lgui new view <包>/<组件> --pattern <模式>` | 按排布模式生成横竖两版界面和 View 骨架 |
| `lgui editor` | 打开编辑器（每次都从本工程的 `ui/` 读取；要在编辑器里保存回 `ui/`，在编辑器里「从文件夹导入」本工程的 `ui/` 并允许读写。端口固定（`editorPort`），浏览器一般会记住授权；浏览器忘了时要再导入一次，不然保存不会写回 `ui/`） |
| `lgui editor props <组件> <控件> <属性>=<值> ...` | 编辑器开着时修改已有控件的属性，编辑器里马上变 |
| `lgui doctor --paths` | 打印规范所在的目录 |

## 规范

运行 `lgui doctor --paths` 打印 `references/` 目录，里面有：
- `ui-spec.md`：UI 开发规范。**改界面**照它第 1 节的固定步骤做。
- `mvc-spec.md`：MVC 开发规范。**写功能**照它第 1 节的固定步骤做。
- `project-layout.md`：工程目录和 `.lgui/project.json` 的字段。
- `error-codes.md`：错误码。
