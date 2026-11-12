// 代码合成声音地址（synth://<名字>）：供 MVC、H5、headless 和 Unity 后端共用。
import {LgRuntimeError} from './errors';

const SYNTH_URL = /^synth:\/\/([A-Za-z0-9][A-Za-z0-9._/-]*)$/;

/** 是不是 synth:// 地址。 */
export function isSynthUrl(url: string): boolean {
  return url.startsWith('synth://');
}

/** 是不是写法合法的 synth://<名字> 地址。 */
export function isValidSynthUrl(url: string): boolean {
  return SYNTH_URL.test(url);
}

/** synth:// 地址写法不对时的报错（LGUI-RT-170）。 */
export function invalidSynthUrlError(url: string): LgRuntimeError {
  return new LgRuntimeError(
    'LGUI-RT-170',
    `合成声音地址「${url}」写法不对。`,
    "写成 synth://<名字>（名字以字母或数字开头，只能用字母、数字和 . _ / -），比如 'synth://click'、'synth://bgm/menu'。"
  );
}

/** synth:// 地址落到后端默认的声音出口时的报错（LGUI-RT-170）。 */
export function defaultAudioSynthError(url: string): LgRuntimeError {
  return new LgRuntimeError(
    'LGUI-RT-170',
    `声音 ${url} 是代码合成声音（synth://），默认的声音出口不播放它。`,
    '在 lgui.app({ platform: { audio } }) 里传入自定义的 AudioService 来合成播放。'
  );
}
