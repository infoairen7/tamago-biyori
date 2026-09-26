// 描画に依存しないゲームモデル。熱・焼き加減の更新と採点を行います。
// 02_GAME_UX_SPEC.md「5. 焼き加減と初期モデル」の式を土台に、採点バージョン2.0.0で
// 油の種類・油の量・差し水（蒸気）・縁の焼き目の目標を加えています。
// サラダ油・ふつう・差し水なし・縁「ほんのり」のときは、仕様書の初期モデルとまったく同じ計算になります。
// 実際の食品の温度・安全性・調理時間を表すものではありません（ゲーム専用の簡易モデル）。
import { GAME_CONFIG, MAX_STEPS, type CookParams, type EdgeTargetConfig, type GameConfig, type HeatLevel } from './config.ts';

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
  /** 差し水の蒸気 0〜1（差した瞬間に1、蒸発して0へ） */
  S: number;
  /** 蒸し焼きで黄身にかかる白い膜 0〜1（見た目のみ・採点しない） */
  F: number;
  /** 早すぎる差し水による白身の水っぽさ 0〜1 */
  wet: number;
  /** 差し水をしたstep（未使用ならnull）。1回の調理で1回まで */
  waterStep: number | null;
  /** 着地からの経過ステップ数（整数） */
  step: number;
  heat: HeatLevel;
  lidClosed: boolean;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** 卵がパンに着地した瞬間の状態：T=.25、中火、ふた開、W/Y/B/D=0 */
export function initialCookState(cfg: GameConfig = GAME_CONFIG): CookState {
  return { T: cfg.initialHeat, W: 0, Y: 0, B: 0, D: 0, S: 0, F: 0, wet: 0, waterStep: null, step: 0, heat: 'medium', lidClosed: false };
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
 * 差し水。パンの熱が少し下がり、蒸気（S=1）が立ちます。1回の調理で1回だけ。
 * 白身がまだ生のうちに差すと、白身が水っぽくなります（wet）。
 */
export function addWater(s: CookState, cfg: GameConfig = GAME_CONFIG): boolean {
  if (s.waterStep !== null) return false;
  const m = cfg.model;
  s.waterStep = s.step;
  s.T = clamp01(s.T - m.waterCooling);
  s.S = 1;
  s.wet = clamp01((m.waterEarlyWhite - s.W) / m.waterEarlyWhite);
  return true;
}

/**
 * 固定ステップ（1/60秒）を1回進めます。状態を直接更新します。
 * 順序：oldWを保持 → T → W → Y → B（oldW判定） → D（oldW判定） → 蒸気と膜 → t。
 */
export function stepCook(s: CookState, p: CookParams, cfg: GameConfig = GAME_CONFIG): void {
  if (s.step >= MAX_STEPS) return;
  const m = cfg.model;
  const dt = cfg.fixedStepSeconds;
  const k = dt * p.eggSpeed;
  const lid = s.lidClosed ? 1 : 0;
  const heatTarget = cfg.heatTargets[s.heat];
  const oldW = s.W;
  const S = s.S;
  // ふたを閉めていると蒸気がこもって効く。開けていると一部だけ
  const steam = S * (lid ? 1 : m.steamOpenFactor);

  s.T = clamp01(s.T + (heatTarget - s.T) * thermalFactor(cfg));
  s.W = clamp01(s.W + k * m.whiteRate * s.T * (1 + m.whiteLidBoost * lid) * (1 + m.steamWhiteBoost * steam));
  s.Y = clamp01(s.Y + k * m.yolkRate * s.T * (1 + m.yolkLidBoost * lid) * (1 + m.steamYolkBoost * steam));
  if (oldW >= m.browningWhiteThreshold) {
    const floor = p.oil.browningHeatFloor;
    s.B = clamp01(
      s.B +
        k *
          m.browningRate *
          p.oil.browning *
          p.amount.browning *
          Math.max(0, (s.T - floor) / (1 - floor)) *
          (1 - m.browningLidReduction * lid) *
          (1 - m.steamBrowningSuppress * S),
    );
  }
  if (oldW >= m.burnWhiteThreshold) {
    s.D = clamp01(
      s.D + k * m.burnRate * p.amount.burn * Math.max(0, (s.T - p.oil.burnHeatFloor) / m.burnHeatSpan) * (1 - m.steamBurnSuppress * S),
    );
  }
  if (S > 0) {
    s.F = clamp01(s.F + dt * m.filmRate * steam);
    s.S = Math.max(0, S - dt * (m.evaporationBase + m.evaporationHeat * s.T) * (lid ? 1 : m.evaporationOpenMultiplier));
  }
  s.step += 1;
}

export type CapKind = 'rawWhite' | 'burn';

export interface ScoreBreakdown {
  whiteFit: number;
  yolkFit: number;
  /** 縁の焼き目の合い具合（白身の合い具合を掛けたもの） */
  brownFit: number;
  /** 白身の基礎点（0〜40、丸め前） */
  whitePoints: number;
  /** 黄身の基礎点（0〜40、丸め前） */
  yolkPoints: number;
  /** 縁の基礎点（0〜20、丸め前） */
  brownPoints: number;
  /** 基礎点の合計（丸め前） */
  base: number;
  /** 焦げ減点後（丸め前） */
  afterBurn: number;
  /** 水っぽさの減点後（丸め前） */
  afterWet: number;
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
  /** 水っぽさ（省略時0） */
  wet?: number;
  /** 黄身の白い膜（見た目のみ。省略時0） */
  F?: number;
}

/** 採点。丸めは最終点でのみ行います。 */
export function scoreCook(f: FinalCook, targetY: number, edge: Pick<EdgeTargetConfig, 'targetB' | 'tolerance' | 'falloff'>, cfg: GameConfig = GAME_CONFIG): ScoreBreakdown {
  const sc = cfg.score;
  const [wWhite, wYolk, wBrown] = sc.weights;
  const whiteFit = clamp01(f.W / sc.whiteIdeal);
  const yolkFit = clamp01(1 - Math.max(0, Math.abs(f.Y - targetY) - sc.yolkTolerance) / sc.yolkFalloff);
  const edgeShape = clamp01(1 - Math.max(0, Math.abs(f.B - edge.targetB) - edge.tolerance) / edge.falloff);
  const brownFit = (sc.brownRequiresWhiteFit ? whiteFit : 1) * edgeShape;

  const whitePoints = wWhite * whiteFit;
  const yolkPoints = wYolk * yolkFit;
  const brownPoints = wBrown * brownFit;
  const base = whitePoints + yolkPoints + brownPoints;
  const afterBurn = base * (1 - sc.burnPenalty * f.D);
  const afterWet = afterBurn * (1 - sc.wetPenalty * clamp01(f.wet ?? 0));

  let raw = afterWet;
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
  return { whiteFit, yolkFit, brownFit, whitePoints, yolkPoints, brownPoints, base, afterBurn, afterWet, cap, raw, score };
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

/** 水っぽさの減点（表示用、整数）。 */
export function displayWetPenalty(b: ScoreBreakdown): number {
  return Math.max(0, Math.round(b.afterBurn) - Math.round(b.afterWet));
}
