using System;
using System.Collections.Generic;
using System.Reflection;
using FairyGUI;
using TMPro;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;

namespace LGUI
{
    public static partial class Platform
    {
        // Project fonts are drawn with TextMesh Pro (SDF). The font asset is dynamic: a glyph is rendered into the atlas the
        // first time it is shown (nothing is baked in the Editor), and a new atlas texture is added when one is full.
        // Sampling 64 pt with 6 px padding (about 10%) on 2048 x 2048 atlases: roughly 800 CJK glyphs per atlas.
        const int SamplingPointSize = 64;
        const int AtlasPadding = 6;
        const int AtlasSize = 2048;

        // System fonts tried, in order, as the TMP fallback for characters that are not in the project font subset
        // (chat, player names). The first one found on this device is used for every project font.
        static readonly string[][] FallbackCandidates =
        {
            new[] { "PingFang SC", "Regular" },          // iOS, macOS
            new[] { "Noto Sans CJK SC", "Regular" },     // Android (AOSP and most vendors), many Linux desktops
            new[] { "Noto Sans SC", "Regular" },
            new[] { "Source Han Sans SC", "Regular" },
            new[] { "Microsoft YaHei", "Regular" },      // Windows
            new[] { "Droid Sans Fallback", "Regular" },  // older Android
            new[] { "WenQuanYi Micro Hei", "Regular" },  // Linux
        };

        static bool _fallbackSearched;
        static TMP_FontAsset _fallback;
        static string _fallbackName = "";

        static void FindFallback()
        {
            if (_fallbackSearched) return;
            _fallbackSearched = true;
            foreach (string[] candidate in FallbackCandidates)
            {
                // Returns null when no installed font has this family and style.
                TMP_FontAsset asset = TMP_FontAsset.CreateFontAsset(candidate[0], candidate[1], SamplingPointSize);
                if (asset == null) continue;
                asset.name = candidate[0];
                _fallback = asset;
                _fallbackName = candidate[0];
                return;
            }
        }

        /// <summary>
        /// Registers a project font with FairyGUI under its name, as a FairyGUI <see cref="TMPFont"/> that asks TMP for Regular
        /// glyphs only (<see cref="ProjectTMPFont"/>). The source is the
        /// subset that lgui unity export wrote to Assets/LGUI/Resources/UI/fonts/&lt;name&gt;.ttf|.otf (imported by Unity as a
        /// Font with its font data). The system fallback font (if any) is attached to it. Returns false when the resource is
        /// missing, is not a Font, or TMP cannot build a font asset from it; the TypeScript backend turns that into LGUI-RT-181.
        /// </summary>
        public static bool RegisterFont(string name, string resourcePath)
        {
            Font font = Resources.Load<Font>(resourcePath);
            if (font == null) return false;
            TMP_FontAsset asset = TMP_FontAsset.CreateFontAsset(font, SamplingPointSize, AtlasPadding, GlyphRenderMode.SDFAA,
                AtlasSize, AtlasSize, AtlasPopulationMode.Dynamic, true);
            if (asset == null) return false;
            asset.name = name;
            FindFallback();
            if (_fallback != null) asset.fallbackFontAssetTable = new List<TMP_FontAsset> { _fallback };
            var tmp = new ProjectTMPFont();
            tmp.name = name;
            tmp.fontAsset = asset;
            FontManager.RegisterFont(tmp, name);
            return true;
        }

        // FairyGUI's TMPFont asks TMP for glyphs of weight Medium by default (TMPFont.cs:51) and Bold for bold text
        // (TMPFont.cs:316). The font assets built above have no typefaces in their font weight table, and for a weight other
        // than Regular TMP looks only for an alternative typeface and does not add the glyph from the font file: the glyph is
        // missing, the text has zero width and nothing is drawn (tested on Unity 6000.6.6f1, com.unity.ugui 2.6.0). Project fonts are
        // single-weight files (ui-spec: a real bold weight is another font), so every glyph is asked for as Regular: plain text
        // through TMPFont.fontWeight, bold text by resetting the weight TMPFont.SetFormat chose. Bold keeps FontStyles.Bold, so
        // FairyGUI still draws it bold with the shader (faux bold, wider spacing and padding). The FairyGUI files are not changed.
        sealed class ProjectTMPFont : TMPFont
        {
            // TMPFont has no setter for the bold weight. The field is part of the FairyGUI copy in this package
            // (tests/unit/unity/tmp-setup.test.mjs checks it); if it is missing, registering a font throws instead of drawing nothing.
            static readonly FieldInfo QueryWeight = typeof(TMPFont).GetField("_fontWeight", BindingFlags.NonPublic | BindingFlags.Instance);

            public ProjectTMPFont()
            {
                if (QueryWeight == null || QueryWeight.FieldType != typeof(FontWeight))
                    throw new MissingFieldException("FairyGUI.TMPFont._fontWeight (FontWeight) not found: the FairyGUI copy in the LGUI package was changed, project fonts cannot ask TMP for Regular glyphs.");
                fontWeight = FontWeight.Regular;
            }

            public override void SetFormat(TextFormat format, float fontSizeScale)
            {
                base.SetFormat(format, fontSizeScale);
                if (format.bold) QueryWeight.SetValue(this, FontWeight.Regular);
                _sizeScale = fontSizeScale;
            }

            // Stroke and shadow. LGUI XML writes strokeSize and shadowOffset in design pixels, and FairyGUI keeps them as they are
            // in TextFormat.outline / shadowOffset. Its TMPFont hands those numbers straight to the TMP SDF shader
            // (_OutlineWidth, _UnderlayOffsetX/Y), where they are fractions of the SDF range, not pixels: strokeSize 3 covered the
            // whole glyph, shadowOffset 7,7 was cut off by the glyph quad. Before a text mesh is built (TextField.OnPopulateMesh
            // calls SetFormat with the size after autoSize shrink, then StartDraw), the pixels are converted into SDF units for the
            // size the text is drawn at, so the stroke and shadow keep their pixel size like on the web, and TMPFont computes its
            // shader ratios and glyph padding again from those values. The FairyGUI files are not changed.
            //
            // Units (k = atlas texels per design pixel at this size, P = atlas padding, w = the largest style weight / 4):
            //  - stroke s px: TMP draws the outline across the glyph edge, half inside. To keep the fill and show s px outside (as
            //    on the web, H5 patch 7), outline width and face dilate are both s*k / (SdfOutlineUnit * P): the outline is s px
            //    wide and the dilate moves it out by half its width. Valid while w + dilate + outline <= 1.
            //  - shadow o px: the shader moves the underlay by offset * ratioC * gradientScale texels, and TMPFont's ratioC is
            //    P * (1 - w - dilate) / gradientScale, so the offset is o*k / (P * (1 - w - dilate)). Valid while offset + dilate <= 1.
            // Beyond those limits the SDF has no data that far from the glyph: LGUI-RT-183 is logged (lgui check reports
            // LGUI-UI-081 before that, at 7.5% of fontSize) and the shader draws what it can; nothing is clamped silently.
            //
            // SdfOutlineUnit: SDF distance units per gradientScale texels (TMP's GetPadding treats an outline of 1 as reaching
            // gradientScale texels outside the glyph, i.e. 2). It is measured on Windows: see tests/unity/fonts/README.md.
            const float SdfOutlineUnit = 2f;
            static readonly HashSet<string> ReportedEffects = new HashSet<string>();
            readonly TextFormat _effects = new TextFormat();
            float _sizeScale = 1;

            public override void StartDraw(NGraphics graphics)
            {
                var field = graphics.meshFactory as TextField;
                if (field != null && ConvertEffects(field.textFormat, _sizeScale))
                {
                    // TMPFont.BuildGraphics computes ratios, padding and the shader values of the text and of each atlas
                    // sub-mesh in use; it only visits atlases marked active since the last call, so mark the ones in use again.
                    if (graphics.subInstances != null)
                        foreach (NGraphics sub in graphics.subInstances)
                            if (sub.texture != null) sub.texture.lastActive = 1;
                    base.Prepare(_effects);
                    base.BuildGraphics(graphics);
                    base.SetFormat(field.textFormat, _sizeScale);
                    if (field.textFormat.bold) QueryWeight.SetValue(this, FontWeight.Regular);
                }
                base.StartDraw(graphics);
            }

            /// <summary>Fills _effects with format, stroke and shadow in SDF units. False when the text has neither.</summary>
            bool ConvertEffects(TextFormat format, float sizeScale)
            {
                bool stroke = format.outline > 0;
                bool shadow = format.shadowOffset.x != 0 || format.shadowOffset.y != 0;
                if (!stroke && !shadow) return false;
                float size = format.size * sizeScale;
                if (size <= 0) return false;
                float k = fontAsset.faceInfo.pointSize / (size * fontAsset.faceInfo.scale);
                float p = fontAsset.atlasPadding;
                float w = Mathf.Max(fontAsset.normalStyle, fontAsset.boldStyle) / 4f;
                float dilate = stroke ? format.outline * k / (SdfOutlineUnit * p) : 0;
                float room = 1 - w - format.faceDilate - dilate; // TMPFont's ratioC: P * (1 - weight - faceDilate) / gradientScale
                Vector2 offset = shadow && room > 0 ? format.shadowOffset * (k / (p * room)) : Vector2.zero;

                _effects.CopyFrom(format);
                _effects.outlineColor = format.outlineColor;
                _effects.outline = dilate;
                _effects.outlineSoftness = format.outlineSoftness;
                _effects.faceDilate = format.faceDilate + dilate;
                _effects.shadowColor = format.shadowColor;
                _effects.shadowOffset = offset;
                _effects.underlaySoftness = format.underlaySoftness;

                bool fits = w + format.faceDilate + 2 * dilate <= 1 && (!shadow || (room > 0 && Mathf.Max(Mathf.Abs(offset.x), Mathf.Abs(offset.y)) + format.faceDilate + dilate <= 1));
                if (!fits)
                {
                    float limit = p * (1 - w) / k;
                    string key = name + "|" + size + "|" + format.outline + "|" + format.shadowOffset;
                    if (ReportedEffects.Add(key))
                        Debug.LogError("LGUI-RT-183 Fonts.cs: text stroke and shadow are larger than font " + name + " can draw at size " + size.ToString("0.#") +
                            (sizeScale < 1 ? " (fontSize " + format.size + " after autoSize shrink)" : "") + ": strokeSize " + (stroke ? format.outline : 0) +
                            " + shadowOffset " + (shadow ? format.shadowOffset.x + "," + format.shadowOffset.y : "0,0") + ", at most about " + limit.ToString("0.#") +
                            " design px together. Use a smaller strokeSize / shadowOffset or a larger fontSize (lgui check allows 7.5% of fontSize, LGUI-UI-081); the stroke and shadow are drawn smaller than written.");
                }
                return true;
            }
        }

        /// <summary>
        /// Whether the TextMesh Pro settings asset ("TMP Settings", imported with TMP Essential Resources) is in a Resources folder.
        /// TMP_FontAsset.CreateFontAsset reads TMP_Settings and throws a NullReferenceException without it, so the TypeScript
        /// backend checks this first and reports LGUI-RT-181. Loaded directly: TMP_Settings.instance opens TMP's importer window in the Editor.
        /// </summary>
        public static bool TmpSettingsFound
        {
            get { return Resources.Load<TMP_Settings>("TMP Settings") != null; }
        }

        /// <summary>Family name of the system font used as the fallback for project fonts; empty when none of the candidates is installed.</summary>
        public static string FallbackFontName
        {
            get { FindFallback(); return _fallbackName; }
        }

        /// <summary>The system font families tried as the fallback, in order, separated by commas (for the LGUI-RT-182 message).</summary>
        public static string FallbackFontCandidates
        {
            get
            {
                var names = new List<string>();
                foreach (string[] candidate in FallbackCandidates) names.Add(candidate[0]);
                return string.Join(", ", names);
            }
        }
    }
}
