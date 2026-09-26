// 描画の選択と管理。WebGL 2が使えれば3D、使えない・初期化失敗・重大な描画失敗では軽量2Dへ切り替えます。
// レンダラーは画面をまたいで生かしておき（コンテキストを作り直さない）、調理画面に来たら貼り付けます。
import type { EggConfig, OilConfig } from '../../shared/config.ts';
import type { FinalCook } from '../../shared/model.ts';
import type { EggShape } from '../../shared/shape.ts';
import { Canvas2DRenderer, drawPlateSnapshot2D } from './canvas2d/Canvas2DRenderer.ts';
import { ThreeRenderer } from './three/ThreeRenderer.ts';
import type { QualityLevel, SceneRenderer } from './types.ts';
import type { QualitySetting, RenderSetting } from '../game/storage.ts';

export type HostEvent =
  | { type: 'mode'; mode: '3d' | '2d'; reason: string | null }
  | { type: 'contextLost' }
  | { type: 'contextRestored' };

export function autoQuality(): QualityLevel {
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  return coarse && (cores <= 4 || mem <= 3) ? 'low' : 'high';
}

export class SceneHost {
  renderer: SceneRenderer | null = null;
  fallbackReason: string | null = null;
  private listeners = new Set<(e: HostEvent) => void>();
  private container: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private renderMode: RenderSetting;
  private qualitySetting: QualitySetting;
  private quality: QualityLevel;
  private contextLost = false;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(renderMode: RenderSetting, quality: QualitySetting) {
    this.renderMode = renderMode;
    this.qualitySetting = quality;
    this.quality = quality === 'auto' ? autoQuality() : quality;
  }

  on(fn: (e: HostEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: HostEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get mode(): '3d' | '2d' | null {
    return this.renderer?.kind ?? null;
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  get currentQuality(): QualityLevel {
    return this.quality;
  }

  /** 設定変更（表示モード・画質） */
  configure(renderMode: RenderSetting, quality: QualitySetting) {
    const modeChanged = renderMode !== this.renderMode;
    this.renderMode = renderMode;
    this.qualitySetting = quality;
    this.quality = quality === 'auto' ? autoQuality() : quality;
    if (modeChanged && this.renderer) {
      const want3d = renderMode !== '2d';
      if ((this.renderer.kind === '3d') !== want3d) this.replace(want3d ? null : 'user');
    } else {
      this.renderer?.setQuality(this.quality);
      this.refit();
    }
  }

  /** 自動画質で重いと判断した場合に下げる */
  degradeQuality() {
    if (this.qualitySetting !== 'auto' || this.quality === 'low') return;
    this.quality = 'low';
    this.renderer?.setQuality('low');
    this.refit();
  }

  ensure(): SceneRenderer {
    if (this.renderer) return this.renderer;
    this.create(this.renderMode === '2d' ? 'user' : null);
    return this.renderer!;
  }

  private create(forced2dReason: string | null) {
    let r: SceneRenderer | null = null;
    let reason = forced2dReason;
    if (!forced2dReason) {
      if (!ThreeRenderer.isSupported()) {
        reason = 'webgl2_unavailable';
      } else {
        try {
          r = new ThreeRenderer(this.quality, {
            onContextLost: () => this.handleLost(),
            onContextRestored: () => this.handleRestored(),
            onFatal: (msg) => this.switchTo2D(`render_error:${msg}`),
          });
        } catch (e) {
          console.warn('[scene] 3D init failed', e);
          reason = 'init_failed';
          r = null;
        }
      }
    }
    if (!r) r = new Canvas2DRenderer(this.quality);
    this.renderer = r;
    this.fallbackReason = r.kind === '2d' ? reason : null;
    if (this.container) this.mount(this.container);
    this.emit({ type: 'mode', mode: r.kind, reason: this.fallbackReason });
  }

  private replace(forced2dReason: string | null) {
    const old = this.renderer;
    this.renderer = null;
    if (old) {
      try {
        old.dispose();
      } catch {
        /* noop */
      }
    }
    this.contextLost = false;
    this.create(forced2dReason);
  }

  switchTo2D(reason: string) {
    if (this.renderer?.kind === '2d') return;
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.replace(reason);
  }

  private handleLost() {
    this.contextLost = true;
    this.emit({ type: 'contextLost' });
    // 一定時間で復旧しなければ2Dへ
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.lostTimer = setTimeout(() => {
      if (this.contextLost) this.switchTo2D('context_lost');
    }, 4000);
  }

  private handleRestored() {
    this.contextLost = false;
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.emit({ type: 'contextRestored' });
  }

  attach(container: HTMLElement) {
    this.container = container;
    this.ensure();
    this.mount(container);
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.refit());
    this.ro.observe(container);
  }

  private mount(container: HTMLElement) {
    const r = this.renderer;
    if (!r) return;
    if (r.canvas.parentElement !== container) container.appendChild(r.canvas);
    this.refit();
  }

  refit() {
    const c = this.container;
    const r = this.renderer;
    if (!c || !r) return;
    const rect = c.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) r.resize(rect.width, rect.height);
  }

  detach() {
    this.ro?.disconnect();
    this.ro = null;
    if (this.renderer?.canvas.parentElement) this.renderer.canvas.remove();
    this.container = null;
  }

  /** 皿の画像。3Dで失敗したら2Dで描きます（同じ状態から）。 */
  snapshot(cook: FinalCook, egg: EggConfig, shape: EggShape, width: number, height: number, oil?: OilConfig): HTMLCanvasElement {
    const r = this.ensure();
    try {
      if (!this.contextLost) return r.snapshotPlate(cook, egg, shape, width, height, oil);
    } catch (e) {
      console.warn('[scene] snapshot failed, using 2D', e);
    }
    return drawPlateSnapshot2D(cook, egg, shape, width, height, oil);
  }

  /** 検証用：コンテキストロストを発生させる（3Dのみ） */
  debugLoseContext(): boolean {
    const r = this.renderer;
    return r instanceof ThreeRenderer ? r.debugLoseContext() : false;
  }
}
