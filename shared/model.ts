// 描画に依存しないゲームモデル。熱・焼き加減の更新と採点を行います。
// 02_GAME_UX_SPEC.md「5. 焼き加減と初期モデル」の式をそのまま実装しています。
// 実際の食品の温度・安全性・調理時間を表すものではありません（ゲーム専用の簡易モデル）。
import { GAME_CONFIG, MAX_STEPS, type GameConfig, type HeatLevel } from './config.ts';

export interface CookState {
  /** パンの熱 0〜1 */
  T: number;
  /** 白身の固まり 0〜1 */
  W: number;
  /** 黄身の固まり 0〜1 */
  Y: number;
  /** 縁の焼き色 0〜1 */
  B: number;
  /** 焦げ 0〜1 */
  D: number;
  /** 着地からの経過ステップ数（整数） */
  step: number;
  heat: HeatLevel;
  lidClosed: boolean;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** 卵がパンに着地した瞬間の状態：T=.25、中火、ふた開、W/Y/B/D=0 */
export function initialCookState(cfg: GameConfig = GAME_CONFIG): CookState {
  return { T: cfg.initialHeat, W: 0, Y: 0, B: 0, D: 0, step: 0, heat: 'medium', lidClosed: false };
}

export function cloneCookState(s: CookState): CookState {
  return { ...s };
}

const thermalFactorCache = new WeakMap<GameConfig, number>();
function thermalFactor(cfg: GameConfig): number {
  let f = thermalFactorCache.get(cfg);
  if (f === undefined) {
    f = 1 - Math.exp(-cfg.fixedStepSeconds / cfg.thermalTimeConstant);
    thermalFactorCache.set(cfg, f);
  }
  return f;
}

/**
 * 固定ステップ（1/60秒）を1回進めます。状態を直接更新します。
 * 仕様の順序：oldWを保持 → T → W → Y → B（oldW判定） → D（oldW判定） → t。
 */
export function stepCook(s: CookState, eggSpeed: number, cfg: GameConfig = GAME_CONFIG): void {
  if (s.step >= MAX_STEPS) return;
  const m = cfg.model;
  const dt = cfg.fixedStepSeconds;
  const lid = s.lidClosed ? 1 : 0;
  const heatTarget = cfg.heatTargets[s.heat];
  const oldW = s.W;

  s.T = clamp01(s.T + (heatTarget - s.T) * thermalFactor(cfg));
  s.W = clamp01(s.W + dt * eggSpeed * m.whiteRate * s.T * (1 + m.whiteLidBoost * lid));
  s.Y = clamp01(s.Y + dt * eggSpeed * m.yolkRate * s.T * (1 + m.yolkLidBoost * lid));
  if (oldW >= m.browningWhiteThreshold) {
    s.B = clamp01(
      s.B +
        dt * eggSpeed * m.browningRate * Math.max(0, (s.T - m.browningHeatFloor) / m.browningHeatSpan) * (1 - m.browningLidReduction * lid),
    );
  }
  if (oldW >= m.burnWhiteThreshold) {
    s.D = clamp01(s.D + dt * eggSpeed * m.burnRate * Math.max(0, (s.T - m.burnHeatFloor) / m.burnHeatSpan));
  }
  s.step += 1;
}

export type CapKind = 'rawWhite' | 'burn';

export interface ScoreBreakdown {
  whiteFit: number;
  yolkFit: number;
  brownFit: number;
  /** 白身の基礎点（0〜40、丸め前） */
  whitePoints: number;
  /** 黄身の基礎点（0〜40、丸め前） */
  yolkPoints: number;
  /** 焼き色の基礎点（0〜20、丸め前） */
  brownPoints: number;
  /** 基礎点の合計（丸め前） */
  base: number;
  /** 焦げ減点後（丸め前） */
  afterBurn: number;
  /** 適用された得点上限（なければnull） */
  cap: { kind: CapKind; value: number } | null;
  /** 上限適用後の値（丸め前） */
  raw: number;
  /** 最終点（整数 0〜100） */
  score: number;
}

export interface FinalCook {
  W: number;
  Y: number;
  B: number;
  D: number;
}

/** 採点。丸めは最終点でのみ行います。 */
export function scoreCook(f: FinalCook, targetY: number, cfg: GameConfig = GAME_CONFIG): ScoreBreakdown {
  const sc = cfg.score;
  const [wWhite, wYolk, wBrown] = sc.weights;
  const whiteFit = clamp01(f.W / sc.whiteIdeal);
  const yolkFit = clamp01(1 - Math.max(0, Math.abs(f.Y - targetY) - sc.yolkTolerance) / sc.yolkFalloff);
  const brownShape = clamp01(1 - Math.max(0, Math.abs(f.B - sc.brownTarget) - sc.brownTolerance) / sc.brownFalloff);
  const brownFit = (sc.brownRequiresWhiteFit ? whiteFit : 1) * brownShape;

  const whitePoints = wWhite * whiteFit;
  const yolkPoints = wYolk * yolkFit;
  const brownPoints = wBrown * brownFit;
  const base = whitePoints + yolkPoints + brownPoints;
  const afterBurn = base * (1 - sc.burnPenalty * f.D);

  let raw = afterBurn;
  let cap: ScoreBreakdown['cap'] = null;
  if (f.W < sc.rawWhiteThreshold && raw > sc.rawWhiteCap) {
    raw = sc.rawWhiteCap;
    cap = { kind: 'rawWhite', value: sc.rawWhiteCap };
  }
  if (f.D >= sc.burnThreshold && raw > sc.burnCap) {
    raw = sc.burnCap;
    cap = { kind: 'burn', value: sc.burnCap };
  }
  const score = Math.round(clamp(raw, 0, 100));
  return { whiteFit, yolkFit, brownFit, whitePoints, yolkPoints, brownPoints, base, afterBurn, cap, raw, score };
}

/**
 * 表示用に基礎点を整数へ配分します（最大剰余法）。
 * 3項目の表示値の合計が round(base) と必ず一致するため、合計と最終点を取り違えにくくなります。
 */
export function displayBasePoints(b: ScoreBreakdown): { white: number; yolk: number; brown: number; total: number } {
  const parts = [b.whitePoints, b.yolkPoints, b.brownPoints];
  const total = Math.round(b.base);
  const floors = parts.map((p) => Math.floor(p + 1e-9));
  let remain = total - floors.reduce((a, c) => a + c, 0);
  const order = parts
    .map((p, i) => ({ i, frac: p - floors[i] }))
    .sort((a, c) => c.frac - a.frac || a.i - c.i);
  const out = [...floors];
  for (let k = 0; k < order.length && remain > 0; k++, remain--) out[order[k].i] += 1;
  return { white: out[0], yolk: out[1], brown: out[2], total };
}

/** 焦げ減点（表示用、整数）。基礎点の表示合計から焦げ後の丸め値を引いたもの。 */
export function displayBurnPenalty(b: ScoreBreakdown): number {
  return Math.max(0, Math.round(b.base) - Math.round(b.afterBurn));
}
