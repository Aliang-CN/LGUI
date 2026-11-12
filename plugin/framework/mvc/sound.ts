// 界面声音（references/mvc-spec.md 第 15 节）：
// - 背景音乐：View 的 static music；栈里最上面（toast 层不算）写了 music 的已打开界面决定放哪首，同一首接着放，换曲时固定淡入淡出；
// - 按钮音：ui/ 里按钮的音效（sound 属性），没写用工程配置 sounds.click；按钮的音量（volume 属性）写 0 就不出声；
// - 代码播放：lgui.sound.play（只在 Controller 里用）；
// - 音乐、音效两个声道，各有音量和静音；lgui.sound.settings 能用 pick 读，改了自动存进本地存储，启动时恢复。
// 声音真正从哪里放出来由平台的声音出口决定（后端自带的，或者 lgui.app({ platform: { audio } }) 交进来的）。
import type {UIButton, UIObject} from '../core/index';
import {LgRuntimeError} from '../core/index';
import type {Layer, Readable} from './types';
import {runtime} from './runtime';
import {bus, builtinEvents} from './events';
import {failure, fault} from './log';
import type {UIManager} from './ui/manager';

/** 声道：背景音乐、音效。 */
export type SoundChannel = 'music' | 'sfx';

/** 一个声道的设置。 */
export interface ChannelSettings {
  /** 音量 0–1。 */
  volume: number;
  /** 是否静音。 */
  muted: boolean;
}

/** 声音设置（lgui.sound.settings）。 */
export interface SoundSettings {
  /** 背景音乐。 */
  music: ChannelSettings;
  /** 音效（按钮音、lgui.sound.play）。 */
  sfx: ChannelSettings;
}

/** 换背景音乐时新旧两首淡入淡出的时间（毫秒）。 */
export const MUSIC_FADE_MS = 500;
/** 声音设置存在本地存储的这个键下（后端自动加工程名前缀）。 */
export const SOUND_STORAGE_KEY = 'lgui.sound';

const defaults = (): SoundSettings => ({music: {volume: 1, muted: false}, sfx: {volume: 1, muted: false}});
const channels: readonly SoundChannel[] = ['music', 'sfx'];
// 从上往下找背景音乐的层（toast 层不算）。
const musicLayers: readonly Layer[] = ['modal', 'popup', 'page', 'hud'];

let settings: SoundSettings = defaults();
const listeners = new Set<() => void>();
let currentMusic: string | null = null;
let scheduled = false;
let stop: (() => void) | null = null;

/** lgui.sound.settings：当前的声音设置，能用 pick 读。 */
export const soundSettings: Readable<SoundSettings> = {
  get: () => settings,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
};

// 参数不对是写错了（LGUI-RT-174）：开发和测试里抛错；正式构建里记 error，这次调用不生效。
function check(ok: boolean, message: string): boolean {
  if (!ok) fault(new LgRuntimeError('LGUI-RT-174', message, "照 mvc-spec 第 15 节写：声道是 'music' 或 'sfx'，音量是 0 到 1 的数，静音是 true 或 false，地址是 ui://包名/声音名 或 synth://名字。"));
  return ok;
}
const isChannel = (channel: unknown): channel is SoundChannel => check(channels.includes(channel as SoundChannel), `声道 ${String(channel)} 不对。`);
const isVolume = (volume: unknown): volume is number => check(typeof volume === 'number' && volume >= 0 && volume <= 1, `音量 ${String(volume)} 不在 0 到 1 之间。`);

function valid(value: unknown): value is SoundSettings {
  const ok = (c: unknown): boolean => typeof c === 'object' && c !== null && typeof (c as ChannelSettings).volume === 'number' && (c as ChannelSettings).volume >= 0 && (c as ChannelSettings).volume <= 1 && typeof (c as ChannelSettings).muted === 'boolean';
  return typeof value === 'object' && value !== null && ok((value as SoundSettings).music) && ok((value as SoundSettings).sfx);
}

function update(next: SoundSettings): void {
  settings = next;
  runtime().backend.platform.storage.set(SOUND_STORAGE_KEY, JSON.stringify(next));
  for (const listener of [...listeners]) listener();
}

const effective = (channel: SoundChannel): number => settings[channel].muted ? 0 : settings[channel].volume;

// 声音出口报上来的错：没登记的声音（LGUI-RT-170）是写错了，别的是加载失败（外部失败，LGUI-RT-026）。
function onAudioError(url: string): (error: unknown) => void {
  return error => {
    if (error instanceof LgRuntimeError && error.code === 'LGUI-RT-170') { fault(error, {url}); return; }
    const reason = error instanceof Error ? error.message : String(error);
    failure(error instanceof LgRuntimeError && error.code === 'LGUI-RT-026' ? error : new LgRuntimeError('LGUI-RT-026', `声音 ${url} 加载失败：${reason}`, '确认地址对、文件存在。'), {url});
  };
}

/** 放一次音效，音量 = volume × 音效声道的音量；静音或音量是 0 时不放。 */
function playSfx(url: string, volume: number): void {
  const final = effective('sfx') * volume;
  if (final > 0) runtime().audio.play(url, final, onAudioError(url));
}

/** lgui.sound.play(url, { volume? })。 */
export function play(url: string, options: {volume?: number} = {}): void {
  const volume = options.volume ?? 1;
  if (check(typeof url === 'string' && url !== '', `声音地址 ${String(url)} 不对。`) && isVolume(volume)) playSfx(url, volume);
}

/** lgui.sound.setVolume(声道, 0–1)。 */
export function setVolume(channel: SoundChannel, volume: number): void {
  if (!isChannel(channel) || !isVolume(volume)) return;
  update({...settings, [channel]: {...settings[channel], volume}});
  if (channel === 'music') applyMusicVolume();
}

/** lgui.sound.setMuted(声道, 是否静音)。 */
export function setMuted(channel: SoundChannel, muted: boolean): void {
  if (!isChannel(channel) || !check(typeof muted === 'boolean', `静音 ${String(muted)} 不是 true 或 false。`)) return;
  update({...settings, [channel]: {...settings[channel], muted}});
  if (channel === 'music') applyMusicVolume();
}

/** 内部用：绑定表里的 click 触发时放按钮音。按钮在 ui/ 里写了音效就用它，没写用 sounds.click；音量用按钮在 ui/ 里写的（写 0 就不出声）。 */
export function clickSound(target: UIObject): void {
  const button = 'soundVolume' in target ? target as UIButton : null;
  const url = button?.sound || runtime().config.sounds.click;
  if (url) playSfx(url, button?.soundVolume ?? 1);
}

// ---------- 背景音乐 ----------

/** 栈里最上面写了 music 的界面（正在打开的也算，所以 replace 成放同一首的界面时不会断）。 */
function wantedMusic(): string | null {
  const ui = runtime().ui as UIManager | null;
  if (!ui) return null;
  for (const layer of musicLayers) {
    const entries = ui.stacks[layer].filter(e => e.state === 'open' || e.state === 'opening');
    for (let i = entries.length - 1; i >= 0; i--) {
      const music = (entries[i].cls as {music?: unknown}).music;
      if (typeof music === 'string') return music;
    }
  }
  return null;
}

function applyMusic(): void {
  scheduled = false;
  const wanted = wantedMusic();
  if (wanted === currentMusic) return;
  currentMusic = wanted;
  runtime().audio.music(wanted, effective('music'), MUSIC_FADE_MS, onAudioError(wanted ?? ''));
}

function applyMusicVolume(): void {
  if (currentMusic) runtime().audio.music(currentMusic, effective('music'), MUSIC_FADE_MS, onAudioError(currentMusic));
}

/** 内部用：界面栈变了。放到这一轮的同步代码之后再选曲，所以先关后开（replace）只算一次。 */
export function scheduleMusic(): void {
  if (scheduled) return;
  scheduled = true;
  void Promise.resolve().then(applyMusic);
}

/** 内部用：启动时调用（UIManager 建好之后）。恢复存着的声音设置，跟着界面栈选背景音乐，切到后台时暂停。 */
export function startSound(ui: UIManager): void {
  stop?.();
  currentMusic = null;
  scheduled = false;
  const {backend} = runtime();
  const saved = backend.platform.storage.get(SOUND_STORAGE_KEY);
  let restored = defaults();
  if (saved !== null) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(saved); } catch { /* 下面按格式不对处理 */ }
    if (valid(parsed)) restored = {music: {...parsed.music}, sfx: {...parsed.sfx}};
    else failure(new LgRuntimeError('LGUI-RT-175', `本地存储里的声音设置读不出来（${saved.slice(0, 80)}），用默认值。`, '不需要处理；玩家下次改音量时会重新存。'));
  }
  settings = restored;
  for (const listener of [...listeners]) listener();
  ui.onRemoved = scheduleMusic;
  const offs = [
    bus.on(builtinEvents.viewOpened, scheduleMusic),
    bus.on(builtinEvents.viewClosed, scheduleMusic),
    backend.platform.time.onVisibilityChange(visible => runtime().audio.setPaused(!visible))
  ];
  stop = () => { for (const off of offs) off(); };
}
