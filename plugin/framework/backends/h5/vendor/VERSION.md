# FairyGUI-dom 运行时版本

- 上游：[fairygui/FairyGUI-dom](https://github.com/fairygui/FairyGUI-dom)
- 提交：`fade49fc33bdcd5673351e04637d4cc08d2297f3`
- 上游原文件：该提交的 `dist/fairygui.module.js`，SHA-256：`b8edcee657aac0dc1eb37bc970a6e2881d879eedda6a8176ae165e15a6938752`。原样存在 LGUI 仓库的 `scripts/fairygui-dom/upstream/`（开发用，不随插件发布），一个字节不改。
- `fairygui.module.js`：**生成文件，不要手改。** 由仓库的 `node scripts/fairygui-dom/build.mjs` 把上游原文件按顺序打上 `../fairygui-patches/*.patch` 得到；`npm run check` 会比较它和「上游 + 补丁」是否一致。
- 其余补丁是钩子，H5 后端启动时由 `../fairygui-patches/index.ts` 装上。全部补丁见同目录 `PATCHES.md`。
- 许可见同目录 `FairyGUI-LICENSE.txt`。
