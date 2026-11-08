using System.Diagnostics;
using System.Reflection;
using UnityEngine.Scripting;
using FairyGUI;
using TMPro;

namespace LGUI.Tests
{
    // Development-only readings for tests/unity/fonts/probe.ts. Not part of the LGUI package.
    [Preserve]
    public static class FontProbeMetrics
    {
        static readonly FieldInfo TextFieldFont = typeof(TextField).GetField("_font", BindingFlags.NonPublic | BindingFlags.Instance);

        /// <summary>Type and name of the font FairyGUI registered under this name, e.g. "TMPFont:Noto".</summary>
        [Preserve]
        public static string RegisteredFont(string name)
        {
            BaseFont font = FontManager.GetFont(name);
            return font == null ? "" : font.GetType().Name + ":" + font.name;
        }

        /// <summary>Type and name of the font this text field actually draws with (after layout).</summary>
        [Preserve]
        public static string DrawnWith(GTextField field)
        {
            var text = (TextField)field.displayObject;
            text.EnsureSizeCorrect();
            var font = (BaseFont)TextFieldFont.GetValue(text);
            return font == null ? "" : font.GetType().Name + ":" + font.name;
        }

        /// <summary>Name of the TMP font asset that supplies this character for the project font (the project font itself or its fallback); empty if none.</summary>
        [Preserve]
        public static string ServedBy(string fontName, string character)
        {
            var font = FontManager.GetFont(fontName) as TMPFont;
            if (font == null || string.IsNullOrEmpty(character)) return "";
            bool alternative;
            TMP_Character found = TMP_FontAssetUtilities.GetCharacterFromFontAsset((uint)char.ConvertToUtf32(character, 0), font.fontAsset, true, FontStyles.Normal, FontWeight.Regular, out alternative);
            return found == null || found.textAsset == null ? "" : found.textAsset.name;
        }

        /// <summary>Atlas population mode, multi-atlas flag and atlas texture count of the project font, e.g. "Dynamic,True,1".</summary>
        [Preserve]
        public static string Atlas(string fontName)
        {
            var font = FontManager.GetFont(fontName) as TMPFont;
            if (font == null) return "";
            return font.fontAsset.atlasPopulationMode + "," + font.fontAsset.isMultiAtlasTexturesEnabled + "," + font.fontAsset.atlasTextures.Length;
        }

        /// <summary>Milliseconds to set the text and lay it out (glyphs not yet in the atlas are rendered here).</summary>
        [Preserve]
        public static double LayoutMs(GTextField field, string value)
        {
            var watch = Stopwatch.StartNew();
            field.text = value;
            ((TextField)field.displayObject).EnsureSizeCorrect();
            return watch.Elapsed.TotalMilliseconds;
        }
    }
}
