// ゲーム設定（config/game-config.json）を型付きで読み込みます。
// ブラウザ・サーバー・テストの全てがこのモジュール経由で同じ設定を使います。
import rawConfig from '../config/game-config.json' with { type: 'json' };

export type HeatLevel = 'off' | 'low' | 'medium' | 'high';
export type EggId = 'white' | 'brown' | 'quail';
/** 黄身の仕上がり（目標） */
export type TargetId = 'soft' | 'medium' | 'firm';
/** 縁の焼き目（目標） */
export type EdgeId = 'pale' | 'golden' | 'crispy';
export type OilId = 'salad' | 'butter' | 'sesame';
export type OilAmountId = 'less' | 'normal' | 'more';

export interface EggConfig {
  id: EggId;
  name: string;
  gameSpeed: number;
  visualScale: number;
  image: string;
}

export interface TargetConfig {
  id: TargetId;
  label: string;
  targetY: number;
}

export interface EdgeTargetConfig {
  id: EdgeId;
  label: string;
  targetB: number;
  tolerance: number;
  falloff: number;
  description: string;
}

export interface OilConfig {
  id: OilId;
  name: string;
  /** 焼き色の進みやすさ（倍率） */
  browning: number;
  /** これより熱いと焼き色が進む（パンの熱T） */
  browningHeatFloor: number;
  /** これより熱いと焦げが進む（パンの熱T） */
  burnHeatFloor: number;
  description: string;
}

export interface OilAmountConfig {
  id: OilAmountId;
  name: string;
  /** 焼き色の進みやすさ（倍率） */
  browning: number;
  /** 焦げの進みやすさ（倍率） */
  burn: number;
  description: string;
}

export interface ModelConfig {
  whiteRate: number;
  whiteLidBoost: number;
  yolkRate: number;
  yolkLidBoost: number;
  browningWhiteThreshold: number;
  browningRate: number;
  browningLidReduction: number;
  burnWhiteThreshold: number;
  burnRate: number;
  burnHeatSpan: number;
  /** 蒸気による白身の進み（倍率の加算分） */
  steamWhiteBoost: number;
  /** 蒸気による黄身の進み（倍率の加算分） */
  steamYolkBoost: number;
  /** ふたを開けているときに蒸気が効く割合 */
  steamOpenFactor: number;
  /** 蒸気がある間、焼き色の進みを抑える割合 */
  steamBrowningSuppress: number;
  /** 蒸気がある間、焦げの進みを抑える割合 */
  steamBurnSuppress: number;
  /** 差し水でパンの熱が下がる量 */
  waterCooling: number;
  evaporationBase: number;
  evaporationHeat: number;
  /** ふたを開けていると蒸発が何倍速いか */
  evaporationOpenMultiplier: number;
  /** 黄身にかかる白い膜の進み（見た目のみ） */
  filmRate: number;
  /** 白身がこれより生の状態で差し水すると水っぽくなる */
  waterEarlyWhite: number;
}

export interface ScoreConfig {
  weights: [number, number, number];
  whiteIdeal: number;
  yolkTolerance: number;
  yolkFalloff: number;
  burnPenalty: number;
  /** 水っぽさ1のときの減点割合 */
  wetPenalty: number;
  rawWhiteThreshold: number;
  rawWhiteCap: number;
  burnThreshold: number;
  burnCap: number;
  brownRequiresWhiteFit: boolean;
}

export interface GameConfig {
  scoringVersion: string;
  fixedStepSeconds: number;
  maxCookingSeconds: number;
  initialHeat: number;
  heatTargets: Record<HeatLevel, number>;
  thermalTimeConstant: number;
  model: ModelConfig;
  eggs: EggConfig[];
  targets: TargetConfig[];
  edgeTargets: EdgeTargetConfig[];
  oils: OilConfig[];
  oilAmounts: OilAmountConfig[];
  score: ScoreConfig;
}

export const GAME_CONFIG = rawConfig as GameConfig;

/** 1秒あたりのステップ数（60）。浮動小数の誤差を避けるため整数に丸める。 */
export const STEPS_PER_SECOND = Math.round(1 / GAME_CONFIG.fixedStepSeconds);
/** 調理上限のステップ数（90秒 × 60 = 5400）。 */
export const MAX_STEPS = Math.round(GAME_CONFIG.maxCookingSeconds * STEPS_PER_SECOND);

export const HEAT_LEVELS: readonly HeatLevel[] = ['off', 'low', 'medium', 'high'];
export const EGG_IDS: readonly EggId[] = GAME_CONFIG.eggs.map((e) => e.id);
export const TARGET_IDS: readonly TargetId[] = GAME_CONFIG.targets.map((t) => t.id);
export const EDGE_IDS: readonly EdgeId[] = GAME_CONFIG.edgeTargets.map((t) => t.id);
export const OIL_IDS: readonly OilId[] = GAME_CONFIG.oils.map((o) => o.id);
export const OIL_AMOUNT_IDS: readonly OilAmountId[] = GAME_CONFIG.oilAmounts.map((o) => o.id);

/** 1回の調理の前に決める内容。卵・黄身の目標・縁の目標がランキングの区分、油は腕の見せどころ。 */
export interface Recipe {
  eggId: EggId;
  targetId: TargetId;
  edgeId: EdgeId;
  oilId: OilId;
  oilAmountId: OilAmountId;
}

/** はじめての1皿（まだ解放していない項目）で使う設定。v1と同じ焼け方になります。 */
export const DEFAULT_EDGE: EdgeId = 'golden';
export const DEFAULT_OIL: OilId = 'salad';
export const DEFAULT_OIL_AMOUNT: OilAmountId = 'normal';

function find<T extends { id: string }>(list: readonly T[], id: string, kind: string): T {
  const v = list.find((e) => e.id === id);
  if (!v) throw new Error(`unknown ${kind}: ${id}`);
  return v;
}

export const getEgg = (id: EggId, cfg: GameConfig = GAME_CONFIG): EggConfig => find(cfg.eggs, id, 'egg');
export const getTarget = (id: TargetId, cfg: GameConfig = GAME_CONFIG): TargetConfig => find(cfg.targets, id, 'target');
export const getEdge = (id: EdgeId, cfg: GameConfig = GAME_CONFIG): EdgeTargetConfig => find(cfg.edgeTargets, id, 'edge');
export const getOil = (id: OilId, cfg: GameConfig = GAME_CONFIG): OilConfig => find(cfg.oils, id, 'oil');
export const getOilAmount = (id: OilAmountId, cfg: GameConfig = GAME_CONFIG): OilAmountConfig => find(cfg.oilAmounts, id, 'oil amount');

const inList = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);
export const isEggId = (v: unknown): v is EggId => inList(EGG_IDS, v);
export const isTargetId = (v: unknown): v is TargetId => inList(TARGET_IDS, v);
export const isEdgeId = (v: unknown): v is EdgeId => inList(EDGE_IDS, v);
export const isOilId = (v: unknown): v is OilId => inList(OIL_IDS, v);
export const isOilAmountId = (v: unknown): v is OilAmountId => inList(OIL_AMOUNT_IDS, v);
export const isHeatLevel = (v: unknown): v is HeatLevel => inList(HEAT_LEVELS, v);

/** モデルの進行に必要な、レシピから決まる係数一式 */
export interface CookParams {
  eggSpeed: number;
  oil: OilConfig;
  amount: OilAmountConfig;
}

export function cookParams(recipe: Pick<Recipe, 'eggId' | 'oilId' | 'oilAmountId'>, cfg: GameConfig = GAME_CONFIG): CookParams {
  return { eggSpeed: getEgg(recipe.eggId, cfg).gameSpeed, oil: getOil(recipe.oilId, cfg), amount: getOilAmount(recipe.oilAmountId, cfg) };
}
