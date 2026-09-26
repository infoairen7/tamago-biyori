// ゲーム設定（config/game-config.json）を型付きで読み込みます。
// ブラウザ・サーバー・テストの全てがこのモジュール経由で同じ設定を使います。
import rawConfig from '../config/game-config.json' with { type: 'json' };

export type HeatLevel = 'off' | 'low' | 'medium' | 'high';
export type EggId = 'white' | 'brown' | 'quail';
export type TargetId = 'soft' | 'medium' | 'firm';

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

export interface ModelConfig {
  whiteRate: number;
  whiteLidBoost: number;
  yolkRate: number;
  yolkLidBoost: number;
  browningWhiteThreshold: number;
  browningRate: number;
  browningHeatFloor: number;
  browningHeatSpan: number;
  browningLidReduction: number;
  burnWhiteThreshold: number;
  burnRate: number;
  burnHeatFloor: number;
  burnHeatSpan: number;
}

export interface ScoreConfig {
  weights: [number, number, number];
  whiteIdeal: number;
  yolkTolerance: number;
  yolkFalloff: number;
  brownTarget: number;
  brownTolerance: number;
  brownFalloff: number;
  burnPenalty: number;
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

export function getEgg(id: EggId, cfg: GameConfig = GAME_CONFIG): EggConfig {
  const egg = cfg.eggs.find((e) => e.id === id);
  if (!egg) throw new Error(`unknown egg: ${id}`);
  return egg;
}

export function getTarget(id: TargetId, cfg: GameConfig = GAME_CONFIG): TargetConfig {
  const target = cfg.targets.find((t) => t.id === id);
  if (!target) throw new Error(`unknown target: ${id}`);
  return target;
}

export function isEggId(v: unknown): v is EggId {
  return typeof v === 'string' && (EGG_IDS as readonly string[]).includes(v);
}

export function isTargetId(v: unknown): v is TargetId {
  return typeof v === 'string' && (TARGET_IDS as readonly string[]).includes(v);
}

export function isHeatLevel(v: unknown): v is HeatLevel {
  return typeof v === 'string' && (HEAT_LEVELS as readonly string[]).includes(v);
}
