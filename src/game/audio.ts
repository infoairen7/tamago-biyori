// 効果音。音源ファイルがなくても Web Audio で簡易音を合成して鳴らします。
// 後からオリジナル音源へ差し替える場合は public/audio/ に置き、SOUND_FILES にパスを書きます。
// 音はユーザー操作（開始ボタンなど）の後にだけ有効化します。音なしでも全機能を使えます。

export type SoundId = 'egg_tap' | 'egg_crack' | 'egg_drop' | 'lid_on' | 'lid_off' | 'plate' | 'result_good' | 'ui';

/** 差し替え用の音源パス（BASE_URLからの相対）。空なら合成音を使います。例: { egg_crack: 'audio/egg_crack.mp3' } */
export const SOUND_FILES: Partial<Record<SoundId | 'sizzle_loop', string>> = {};

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sizzleGain: GainNode | null = null;
  private sizzleFilter: BiquadFilterNode | null = null;
  private sizzleSrc: AudioBufferSourceNode | null = null;
  private noise: AudioBuffer | null = null;
  private files = new Map<string, AudioBuffer>();
  private volume = 0.5;
  private muted = false;
  failed = false;

  /** ユーザー操作の中で呼ぶ */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyVolume();
        this.noise = this.makeNoise(4);
        void this.loadFiles();
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  get available(): boolean {
    return !this.failed && this.ctx !== null;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.master || !this.ctx) return;
    const v = this.muted ? 0 : this.volume * 0.8;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  suspend(): void {
    this.setSizzle(0, false);
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  private async loadFiles() {
    const base = import.meta.env.BASE_URL ?? '/';
    for (const [id, path] of Object.entries(SOUND_FILES)) {
      if (!path || !this.ctx) continue;
      try {
        const res = await fetch(base + path);
        if (!res.ok) continue;
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.files.set(id, buf);
      } catch {
        // 読めなければ合成音のまま
      }
    }
  }

  private makeNoise(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const d = buf.getChannelData(0);
    // じゅわじゅわ：細かなノイズ＋ランダムなパチパチ。ループの継ぎ目を目立たせないよう両端をなじませる
    let crackle = 0;
    for (let i = 0; i < d.length; i++) {
      if (Math.random() < 0.0009) crackle = 0.9 + Math.random() * 0.6;
      crackle *= 0.985;
      d[i] = (Math.random() * 2 - 1) * (0.28 + crackle);
    }
    const fade = Math.floor(rate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
    }
    return buf;
  }

  play(id: SoundId): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out || this.failed || ctx.state !== 'running') return;
    try {
      const file = this.files.get(id);
      if (file) {
        const s = ctx.createBufferSource();
        s.buffer = file;
        s.connect(out);
        s.start();
        return;
      }
      const t = ctx.currentTime;
      switch (id) {
        case 'egg_tap':
          this.noiseBurst(t, 0.05, 3200, 6, 0.5);
          this.tone(t, 1900, 0.06, 0.08, 'triangle');
          break;
        case 'egg_crack':
          this.noiseBurst(t, 0.06, 2600, 5, 0.7);
          this.noiseBurst(t + 0.07, 0.08, 1800, 4, 0.5);
          this.noiseBurst(t + 0.16, 0.12, 1200, 3, 0.25);
          break;
        case 'egg_drop': {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(220, t);
          o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 0.4);
          this.noiseBurst(t + 0.05, 0.6, 5000, 0.8, 0.18);
          break;
        }
        case 'lid_on':
        case 'lid_off':
          this.tone(t, id === 'lid_on' ? 1760 : 2090, 0.35, 0.06, 'sine');
          this.tone(t, id === 'lid_on' ? 2640 : 3130, 0.25, 0.03, 'sine');
          this.noiseBurst(t, 0.03, 4000, 3, 0.12);
          break;
        case 'plate':
          this.noiseBurst(t, 0.45, 900, 0.7, 0.22);
          this.tone(t + 0.35, 1320, 0.25, 0.04, 'sine');
          break;
        case 'result_good':
          [1047, 1319, 1568].forEach((f, i) => this.tone(t + i * 0.12, f, 0.35, 0.14, 'sine'));
          break;
        case 'ui':
          this.tone(t, 880, 0.05, 0.035, 'sine');
          break;
      }
    } catch {
      /* 音は失敗しても無視 */
    }
  }

  private tone(t: number, freq: number, dur: number, vol: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, freq: number, q: number, vol: number) {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 3);
    s.stop(t + dur + 0.02);
  }

  /** 焼ける音（ループ）。level 0〜1、ふたを閉じると少しこもる */
  setSizzle(level: number, lidClosed: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.failed) return;
    try {
      if (!this.sizzleSrc && level > 0.01 && ctx.state === 'running') {
        const src = ctx.createBufferSource();
        const file = this.files.get('sizzle_loop');
        src.buffer = file ?? this.noise;
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1800;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 9000;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(hp).connect(lp).connect(g).connect(this.master);
        src.start();
        this.sizzleSrc = src;
        this.sizzleGain = g;
        this.sizzleFilter = lp;
      }
      if (this.sizzleGain && this.sizzleFilter) {
        const t = ctx.currentTime;
        this.sizzleGain.gain.setTargetAtTime(Math.max(0, level) * 0.32, t, 0.25);
        this.sizzleFilter.frequency.setTargetAtTime(lidClosed ? 2600 : 9000, t, 0.15);
      }
    } catch {
      /* noop */
    }
  }

  stopSizzle(): void {
    try {
      this.sizzleSrc?.stop();
    } catch {
      /* noop */
    }
    this.sizzleSrc?.disconnect();
    this.sizzleSrc = null;
    this.sizzleGain = null;
    this.sizzleFilter = null;
  }
}

export const audio = new AudioEngine();
