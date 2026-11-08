using System.Collections.Generic;
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
        /// Registers a project font with FairyGUI under its name, as a FairyGUI <see cref="TMPFont"/>. The source is the
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
            TMPFont tmp = new TMPFont();
            tmp.name = name;
            tmp.fontAsset = asset;
            FontManager.RegisterFont(tmp, name);
            return true;
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
