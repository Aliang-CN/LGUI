# Actual TMP atlas and shadow inputs

This repository-only regression reads real FairyGUI MeshRenderers after the exported Boot scene has entered Play and the public fixture binding has changed `shadow` to `Il齉` and `runtimeName` to `齉Player`. Use the font visual fixture containing a 64 pt `shadow` field with a 4,4 design-pixel shadow, normal project glyphs and one system fallback glyph. The fixture must be exported normally before the run; this tool does not prepare it, install packages, change text, request glyphs or modify the product package.

Use an existing isolated Unity 6000.6.6f1 project, Node 24.22.1, and fresh evidence:

```text
node tests/unity/fonts/atlas/run.mjs --editor <absolute Unity.exe> --project <absolute isolated exported project> --evidence <new evidence directory>
```

The runner copies only its test-only Editor helper, opens `Assets/LGUI/LGUIBoot.unity`, enters normal Play, waits at least four seconds and for the actual runtime binding, reads the renderer state, requests a raw ScreenCapture PNG, exits Play and exits Unity. It does not pass `-nographics`, force rendering, change resolution, pre-load glyphs or mutate fonts, textures, shared materials, property blocks or generated game resources. The copied project should contain normal UserSettings if its Unity Editor needs search-index configuration; do not disable indexing or hide runtime errors. Do not reuse an original project that must remain unchanged.

The helper matches renderer references to their FairyGUI NGraphics/TextField, including fallback submeshes. It uses `sharedMaterials` and `Renderer.GetPropertyBlock` into fresh temporary blocks. It never accesses `renderer.material`, `NGraphics.material` or the mutating `NGraphics.materialPropertyBlock` getter. It reads existing TMP `atlasTextures` and wrappers, without calling lazy `atlasTexture`, glyph or character lookup APIs. Entity IDs are recorded as `GetEntityId().GetHashCode()` for correlation; direct reference equality also records whether the native texture is the corresponding font atlas.

Two independent assertions remain separate:

```text
node tests/unity/fonts/atlas/checker.mjs <result.json> --check-dimensions
node tests/unity/fonts/atlas/checker.mjs <result.json> --check-shadow
node tests/unity/fonts/atlas/checker.mjs <result.json> --owner combined --expected 0,2
```

Dimensions require each active, nonempty main/fallback renderer to use the actual native atlas width/height, with underlay enabled and nonzero offset/ratio. The checker resolves floats by property presence: a present per-material block takes precedence over a per-renderer block; an unset block float falls back to the shared material rather than its GetFloat zero. Shadow independently computes the shader's atlas UV offset, multiplies by actual native dimensions and divides by actual atlas texels per design pixel from the sampled font face and TextField shrink scale. It requires 4,4 design pixels for both the project and fallback draw. It does not trust the helper's precomputed offset fields.

`result.json` preserves all renderer/material/property-block floats, HasProperty/HasFloat presence, shader keywords, native texture dimensions/format/wrap mode, NTexture cached region/dimensions, actual font face/atlas data, original text format, actual shrink scale, frame and screen dimensions. `result.json.driver.json` preserves runtime warnings/errors and PNG acquisition status. `dimensions.json` and `shadow.json` contain separate verdicts. Original outputs are never overwritten.

Camera.onPostRender is preferred so screenshot request and sample have the same frame number. Editor batch mode may not render its Game view; after a stable Play interval the helper falls back to EditorApplication.update and saves parameters first. If ScreenCapture produces no file within eight seconds, the sampler exits normally with `pngPresent:false` and an explicit acquisition limitation. This is not pixel acceptance. Runtime logs, including expected out-of-range effects and unrelated Editor errors, remain visible; sampler exit 0 means acquisition completed, not that runtime had no errors.

Checker unit tests cover missing samples/presence, stale 1-versus-2048 dimensions, unset zero versus real overrides, per-material precedence and a dimensionally correct fallback whose shadow is incorrectly six pixels:

```text
node --test tests/unity/fonts/atlas/checker.test.mjs
```

For a regression sequence, first save the original package's red dimensions/shadow outputs. Re-run exactly the same exported fixture and helper against one product change in a separate test copy. A dimension-only fix can make dimensions green while the fallback shadow remains red; preserve that intermediate result before a separate conversion fix. Real Editor and Release IL2CPP Player PNGs are independent acceptance evidence.
