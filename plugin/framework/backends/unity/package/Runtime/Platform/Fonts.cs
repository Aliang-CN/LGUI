using FairyGUI;
using UnityEngine;

namespace LGUI
{
    public static partial class Platform
    {
        /// <summary>
        /// Registers a project font with FairyGUI under its name. The font is the subset that lgui unity export wrote to
        /// Assets/LGUI/Resources/UI/fonts/&lt;name&gt;.ttf|.otf (imported by Unity as a dynamic Font). Returns false when the
        /// resource is missing or is not a Font; the TypeScript backend turns that into LGUI-RT-181.
        /// </summary>
        public static bool RegisterFont(string name, string resourcePath)
        {
            Font font = Resources.Load<Font>(resourcePath);
            if (font == null) return false;
            FontManager.RegisterFont(new DynamicFont(name, font), name);
            return true;
        }
    }
}
