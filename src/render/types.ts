import type { EggConfig } from '../../shared/config.ts';
import type { CookState, FinalCook } from '../../shared/model.ts';
import type { EggShape } from '../../shared/shape.ts';
import type { PlayPhase } from '../game/session.ts';

export type RenderPhase = PlayPhase | 'idle';
export type QualityLevel = 'high' | 'low';

export interface RenderView {
  phase: RenderPhase;
  /** フェーズ開始からの実時間（秒） */
  phaseTime: number;
  /** 演出用の連続時間（秒） */
  time: number;
  egg: EggConfig;
  shape: EggShape;
  cook: CookState;
  paused: boolean;
  reducedMotion: boolean;
}

export interface RendererCallbacks {
  /** WebGLコンテキストを失った（シミュレーションを止める） */
  onContextLost?: () => void;
  /** コンテキストが復旧した */
  onContextRestored?: () => void;
  /** 重大な描画失敗（2Dへ切り替える） */
  onFatal?: (reason: string) => void;
}

export interface SceneRenderer {
  readonly kind: '3d' | '2d';
  readonly canvas: HTMLCanvasElement;
  render(view: RenderView): void;
  resize(width: number, height: number): void;
  setQuality(q: QualityLevel): void;
  /** 皿に盛った目玉焼きを、指定の状態から描いた画像を返します（結果画面・共有画像用） */
  snapshotPlate(cook: FinalCook, egg: EggConfig, shape: EggShape, width: number, height: number): HTMLCanvasElement;
  dispose(): void;
}
