// 接口层（相当于 RHI）：导出类型、错误类和与引擎无关的代码图标注册表。
export type {
  Unsubscribe, Rect, PointerInput, UIObject, UIComponent, UIText, UIRichText, UIInput, UIButton,
  UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, UILabel, UISlider, UIComboBox, UIMovieClip, UITree, UITreeNode, UIKinds, UIKind, TweenProp, TransitionTouch,
  IconShape, IconGradient, IconCanvas, IconDef
} from './ui';
export type {
  Platform, TimeService, StorageService, ResourceService, InputService, KeyInput, WheelInput,
  TextInputService, ScreenService, Insets, AudioService, LocaleService, Logger, LogLevel,
  NetService, NetResponse, NetSocket, ClipboardService
} from './platform';
export type {Backend, BackendConfig} from './backend';
export {LgRuntimeError, notImplemented} from './errors';
export {
  registerIcons, setAppIcons, clearIcons, hasRegisteredIcons, isIconUrl, lookupIcon, hasIcon, iconSize,
  missingIconError, unityIconError, iconSvgDataUrl, setIconFaultReporter, reportIconFault
} from './icons';
export type {ShapesIcon, DrawIcon, RegisteredIcon} from './icons';
