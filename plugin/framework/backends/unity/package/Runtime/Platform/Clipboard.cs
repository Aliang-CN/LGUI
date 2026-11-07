using System;
using UnityEngine;

namespace LGUI
{
    public static partial class Platform
    {
        // 剪贴板的报错只写出了什么错（不带错误码和别的建议）：TypeScript 后端统一包成 LGUI-RT-241，并给出剪贴板自己的建议。
        static InvalidOperationException ClipboardFailure(string message, Exception cause = null)
        {
            return new InvalidOperationException(message, cause);
        }

        /// <summary>System clipboard text (GUIUtility.systemCopyBuffer); empty string when it holds no text.</summary>
        public static string ClipboardGet()
        {
            try { return GUIUtility.systemCopyBuffer ?? ""; }
            catch (Exception error) { throw ClipboardFailure("GUIUtility.systemCopyBuffer 读取出错：" + error.Message, error); }
        }

        /// <summary>Puts text on the system clipboard.</summary>
        public static void ClipboardSet(string text)
        {
            if (text == null) throw ClipboardFailure("放进剪贴板的文字是 null。");
            try { GUIUtility.systemCopyBuffer = text; }
            catch (Exception error) { throw ClipboardFailure("GUIUtility.systemCopyBuffer 写入出错：" + error.Message, error); }
        }
    }
}
