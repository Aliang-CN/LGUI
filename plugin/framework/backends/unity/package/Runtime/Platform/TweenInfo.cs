using System;
using System.Reflection;
using FairyGUI;

namespace LGUI
{
    public static partial class Platform
    {
        // 代码补间（mvc/tween）要知道的事：FairyGUI-unity 不公开齿轮、按钮的按下效果和动效的每一项，这里只读出来（不改 FairyGUI 源码）。
        // GObject.GetGear 会顺手建一个齿轮，所以直接读 _gears。只在补间开始、挂载组件时调用，不在每帧调用。
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        static readonly FieldInfo gearsField = typeof(GObject).GetField("_gears", Private);
        static readonly FieldInfo downEffectField = typeof(GButton).GetField("_downEffect", Private);
        static readonly FieldInfo downEffectValueField = typeof(GButton).GetField("_downEffectValue", Private);
        static readonly FieldInfo transitionOwnerField = typeof(Transition).GetField("_owner", Private);
        static readonly FieldInfo transitionItemsField = typeof(Transition).GetField("_items", Private);
        static readonly MethodInfo childByIdMethod = typeof(GComponent).GetMethod("GetChildById", Private);

        static Exception Missing(string what)
        {
            return new InvalidOperationException("LGUI-RT-160  FairyGUI 没有 " + what + "（代码补间要读它）。 → 使用随 LGUI 分发的 FairyGUI-unity。");
        }

        /// <summary>第 index 个齿轮（1 XY、2 Size、3 Look、4 Color、9 FontSize）跟的控制器名；没有这个齿轮是空字符串。</summary>
        public static string GearController(GObject obj, int index)
        {
            if (obj == null) throw Failure("控件为空。");
            if (gearsField == null) throw Missing("GObject._gears");
            var gears = gearsField.GetValue(obj) as GearBase[];
            if (gears == null || index < 0 || index >= gears.Length || gears[index] == null || gears[index].controller == null) return "";
            return gears[index].controller.name;
        }

        /// <summary>按钮的按下效果：0 没有、1 变暗、2 缩放。</summary>
        public static int ButtonDownEffect(GButton button)
        {
            if (button == null) throw Failure("按钮为空。");
            if (downEffectField == null) throw Missing("GButton._downEffect");
            return (int)downEffectField.GetValue(button);
        }

        /// <summary>按钮的 downEffectValue（按下时的缩放或亮度）。</summary>
        public static float ButtonDownEffectValue(GButton button)
        {
            if (button == null) throw Failure("按钮为空。");
            if (downEffectValueField == null) throw Missing("GButton._downEffectValue");
            return (float)downEffectValueField.GetValue(button);
        }

        /// <summary>关掉 FairyGUI 自己的按下缩放（框架接管 downEffect="scale"，按下、松开带缓动）。</summary>
        public static void DisableButtonDownEffect(GButton button)
        {
            if (button == null) throw Failure("按钮为空。");
            if (downEffectField == null) throw Missing("GButton._downEffect");
            downEffectField.SetValue(button, 0);
        }

        static Array TransitionItems(Transition transition)
        {
            if (transition == null) throw Failure("动效为空。");
            if (transitionItemsField == null) throw Missing("Transition._items");
            return transitionItemsField.GetValue(transition) as Array;
        }

        static object ItemField(object item, string name)
        {
            var field = item.GetType().GetField(name, BindingFlags.Instance | BindingFlags.Public);
            if (field == null) throw Missing("TransitionItem." + name);
            return field.GetValue(item);
        }

        /// <summary>动效有几项。</summary>
        public static int TransitionItemCount(Transition transition)
        {
            var items = TransitionItems(transition);
            return items == null ? 0 : items.Length;
        }

        /// <summary>第 index 项的类型（TransitionActionType：0 XY、1 Size、2 Scale、4 Alpha、5 Rotation、6 Color、11 Shake、14 Text……）。</summary>
        public static int TransitionItemType(Transition transition, int index)
        {
            return (int)ItemField(TransitionItems(transition).GetValue(index), "type");
        }

        /// <summary>第 index 项改的控件：和 FairyGUI 放动效时一样，没写目标是组件自己；目标不在了是 null。</summary>
        public static GObject TransitionItemTarget(Transition transition, int index)
        {
            var item = TransitionItems(transition).GetValue(index);
            var target = ItemField(item, "target") as GObject;
            if (target != null) return target;
            if (transitionOwnerField == null || childByIdMethod == null) throw Missing("Transition._owner 或 GComponent.GetChildById");
            var owner = transitionOwnerField.GetValue(transition) as GComponent;
            var id = ItemField(item, "targetId") as string;
            if (owner == null) return null;
            return string.IsNullOrEmpty(id) ? owner : childByIdMethod.Invoke(owner, new object[] { id }) as GObject;
        }
    }
}
