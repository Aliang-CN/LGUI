// h5 的声音出口：Web Audio。浏览器要求用户先点一下或按一下键才能出声：解锁之前要放的背景音乐先记着，解锁后再放；之前的音效不放。
// ui://包名/声音名（也认 ui://包ID资源ID）按 lgui 生成的 manifest.json 找到 <uiBase>/<包名>/<资源ID>.mp3；整首解码进内存，背景音乐循环播放。
import type {AudioService} from '../../../core/index';
import {LgRuntimeError, defaultAudioSynthError, invalidSynthUrlError, isSynthUrl, isValidSynthUrl} from '../../../core/index';

interface Manifest {
  packages: Record<string, {name: string; sounds?: Record<string, {name: string; file: string}>}>;
}

interface Track {
  url: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export function createH5Audio(uiBase: string): {service: AudioService; unlock(): void} {
  let context: AudioContext | null = null;
  let paused = false;
  let manifest: Promise<Manifest> | null = null;
  const buffers = new Map<string, Promise<AudioBuffer>>();
  // 想放的背景音乐（解锁之前、解码之前也记着）和正在放的那一首。
  let target: {url: string; volume: number; onError: (error: unknown) => void} | null = null;
  let current: Track | null = null;
  let fadeMs = 0;

  const loadManifest = (): Promise<Manifest> => manifest ??= fetch(`${uiBase}/manifest.json`).then(r => {
    if (!r.ok) throw new LgRuntimeError('LGUI-RT-010', `读不到散图映射 ${uiBase}/manifest.json（HTTP ${r.status}）。`, '重新运行 lgui dev 生成界面包。');
    return r.json() as Promise<Manifest>;
  });

  // 地址 → 文件地址。没登记的 ui:// 声音或落到默认出口的 synth:// 声音报 LGUI-RT-170。
  async function fileOf(url: string): Promise<string> {
    if (isSynthUrl(url)) throw isValidSynthUrl(url) ? defaultAudioSynthError(url) : invalidSynthUrlError(url);
    if (!url.startsWith('ui://')) return url;
    const rest = url.slice(5);
    for (const [id, pkg] of Object.entries((await loadManifest()).packages)) {
      for (const [resId, sound] of Object.entries(pkg.sounds ?? {})) {
        if (rest === `${pkg.name}/${sound.name}` || rest === id + resId) return `${uiBase}/${pkg.name}/${sound.file}`;
      }
    }
    throw new LgRuntimeError('LGUI-RT-170', `声音 ${url} 没有登记在 ui/ 的包里。`, '把 mp3 放进包目录，在 package.xml 里登记成 <sound … exported="true"/>，地址写成 ui://包名/声音名；或者用代码合成声音 synth://名字。');
  }

  function load(url: string, ctx: AudioContext): Promise<AudioBuffer> {
    let buffer = buffers.get(url);
    if (!buffer) {
      buffer = fileOf(url).then(file => fetch(file)).then(r => {
        if (!r.ok) throw new LgRuntimeError('LGUI-RT-026', `声音 ${url} 加载失败（HTTP ${r.status}）。`, '确认地址对、文件存在。');
        return r.arrayBuffer();
      }).then(data => ctx.decodeAudioData(data));
      buffers.set(url, buffer);
      buffer.then(undefined, () => buffers.delete(url)); // 失败的下次重新加载
    }
    return buffer;
  }

  const seconds = (ms: number): number => ms / 1000;

  function fadeTo(gain: GainNode, volume: number, ms: number): void {
    const now = (context as AudioContext).currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(volume, now + seconds(ms));
  }

  function stop(track: Track): void {
    fadeTo(track.gain, 0, fadeMs);
    track.source.stop((context as AudioContext).currentTime + seconds(fadeMs));
    track.source.onended = () => { track.source.disconnect(); track.gain.disconnect(); };
  }

  // 让正在放的和想放的一致：同一首只改音量；换曲时旧的淡出、新的解码好了淡入。
  function sync(): void {
    const ctx = context;
    const want = target;
    if (!ctx) return;
    if (current && current.url === want?.url) { fadeTo(current.gain, want.volume, 50); return; }
    if (current) { stop(current); current = null; }
    if (!want) return;
    load(want.url, ctx).then(decoded => {
      if (target?.url !== want.url || current?.url === want.url) return; // 已经换了别的，或者已经在放
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(ctx.destination);
      source.start();
      current = {url: want.url, source, gain};
      fadeTo(gain, target.volume, fadeMs);
    }, want.onError);
  }

  const service: AudioService = {
    play(url, volume, onError) {
      const ctx = context;
      if (!ctx) { fileOf(url).then(() => {}, onError); return; } // 还没解锁：不放，只检查地址
      load(url, ctx).then(decoded => {
        if (paused) return;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.buffer = decoded;
        source.connect(gain).connect(ctx.destination);
        source.start();
      }, onError);
    },
    music(url, volume, fade, onError) {
      fadeMs = fade;
      target = url === null ? null : {url, volume, onError};
      if (context) sync();
      else if (url !== null) fileOf(url).then(() => {}, onError); // 解锁后再放；先检查地址
    },
    setPaused(value) {
      paused = value;
      if (context) void (value ? context.suspend() : context.resume());
    }
  };

  /** 第一次点击或按键时调用：建 AudioContext（浏览器只在用户操作时允许），放之前记下的背景音乐。 */
  function unlock(): void {
    if (!context) { context = new AudioContext(); sync(); }
    if (context.state === 'suspended' && !paused) void context.resume();
  }

  return {service, unlock};
}
