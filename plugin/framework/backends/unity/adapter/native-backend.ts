// PuerTS 暴露的 C# 类型边界；只有 Unity 后端读取 CS，全都按固定版本的实际 API 声明。
import type {NativeLoader, NativeObject, NativeRect} from './native-ui';
import type {NativePlatformApi, NativePlatformHost, NativePackageItem} from './native-platform';

export type NativeBackendApi = NativePlatformApi & {
  UIPackage: NativePlatformApi['UIPackage'] & {
    CreateObject(packageName: string, componentName: string): NativeObject | null;
    GetItemByURL(url: string): NativePackageItem | null;
    SetStringsSource(source: unknown): void;
  };
  UIConfig: {defaultFont: string};
  Utils: NativePlatformApi['Utils'] & {XML: new (text: string) => unknown};
};

export interface NativeBridge {
  UnityEngine: {Rect: new (x: number, y: number, width: number, height: number) => NativeRect; Vector2: new (x: number, y: number) => unknown};
  FairyGUI: NativeBackendApi;
  LGUI: {
    Platform: NativePlatformHost;
    LGUIResourceLoader: new () => NativeLoader;
  };
}

export interface UnityGlobals {
  CS?: NativeBridge;
  __lguiFrame?: (deltaMs: number) => void;
  __lguiVisibility?: (visible: boolean) => void;
  __lguiDispose?: () => void;
}
