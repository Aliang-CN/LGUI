using System;
using UnityEngine;

namespace LGUI
{
    public static partial class Platform
    {
        /// <summary>System clipboard text (GUIUtility.systemCopyBuffer); empty string when it holds no text.</summary>
        public static string ClipboardGet()
        {
            try { return GUIUtility.systemCopyBuffer ?? ""; }
            catch (Exception error) { throw Failure("读取系统剪贴板失败：" + error.Message, error); }
        }

        /// <summary>Puts text on the system clipboard.</summary>
        public static void ClipboardSet(string text)
        {
            if (text == null) throw Failure("放进剪贴板的文字不能是 null。");
            try { GUIUtility.systemCopyBuffer = text; }
            catch (Exception error) { throw Failure("写入系统剪贴板失败：" + error.Message, error); }
        }
    }
}
