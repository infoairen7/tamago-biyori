// 採点チューニングの確認用シミュレーション。
// 実行: node scripts/simulate.ts
// 設定値（config/game-config.json）だけで調整し、卵3種 × 黄身3種 × 縁3種の全27条件で
// 90点以上が取れるか、はじめの1皿（サラダ油・ふつう・差し水なし・縁ほんのり）が仕様書どおりかを確認します。
// もっと広く手順を探す場合は scripts/tune-search.ts（数分かかります）。
import {
  DEFAULT_OIL,
  DEFAULT_OIL_AMOUNT,
  GAME_CONFIG,
  MAX_STEPS,
  STEPS_PER_SECOND,
  cookParams,
  getEdge,
  type EdgeTargetConfig,
  type EggConfig,
  type HeatLevel,
  type OilAmountId,
  type OilId,
  type TargetConfig,
} from '../shared/config.ts';
import { addWater, initialCookState, scoreCook, stepCook } from '../shared/model.ts';

/** 時刻（秒）つきの簡単な手順。heatAt/lidAt/waterAt の時刻に操作します。 */
export interface Plan {
  label: string;
  oil: OilId;
  amount: OilAmountId;
  heat: HeatLevel;
  /** [秒, 火力] の順に切り替え */
  heatAt?: [number, HeatLevel][];
  /** ふたを閉じる時刻（秒） */
  lidAt?: number;
  /** 差し水の時刻（秒） */
  waterAt?: number;
}

export interface Window {
  best: number;
  bestAt: number;
  from: number | null;
  to: number | null;
}

/** 手順どおりに焼き続け、各stepでお皿にうつした場合の点数を調べます */
export function scanPlan(egg: EggConfig, target: TargetConfig, edge: EdgeTargetConfig, plan: Plan): Window {
  const params = cookParams({ eggId: egg.id, oilId: plan.oil, oilAmountId: plan.amount });
  const s = initialCookState();
  s.heat = plan.heat;
  let best = -1;
  let bestAt = 0;
  let from: number | null = null;
  let to: number | null = null;
  while (s.step < MAX_STEPS) {
    for (const [at, h] of plan.heatAt ?? []) if (Math.round(at * STEPS_PER_SECOND) === s.step) s.heat = h;
    if (plan.lidAt !== undefined && Math.round(plan.lidAt * STEPS_PER_SECOND) === s.step) s.lidClosed = true;
    if (plan.waterAt !== undefined && Math.round(plan.waterAt * STEPS_PER_SECOND) === s.step) addWater(s);
    stepCook(s, params);
    const sc = scoreCook(s, target.targetY, edge).score;
    if (sc > best) {
      best = sc;
      bestAt = s.step;
    }
    if (sc >= 90) {
      if (from === null) from = s.step;
      to = s.step;
    }
  }
  return { best, bestAt, from, to };
}

const base = { oil: DEFAULT_OIL, amount: DEFAULT_OIL_AMOUNT } as const;

/** 基本の手順（サラダ油・ふつう・差し水なし） */
export const BASIC_PLANS: Plan[] = [
  { ...base, label: '中火・ふた開', heat: 'medium' },
  { ...base, label: '中火・ふた閉', heat: 'medium', lidAt: 0 },
  { ...base, label: '弱火・ふた開', heat: 'low' },
  { ...base, label: '弱火・ふた閉', heat: 'low', lidAt: 0 },
  { ...base, label: '強火10秒→弱火', heat: 'high', heatAt: [[10, 'low']] },
];

/** 油・差し水を使う手順の見本 */
export const TECHNIQUE_PLANS: Plan[] = [
  { oil: 'salad', amount: 'less', label: 'サラダ油少なめ・中火', heat: 'medium' },
  { oil: 'salad', amount: 'less', label: 'サラダ油少なめ・弱火・ふた閉', heat: 'low', lidAt: 0 },
  { oil: 'salad', amount: 'more', label: 'サラダ油たっぷり・中火', heat: 'medium' },
  { oil: 'sesame', amount: 'more', label: 'ごま油たっぷり・中火', heat: 'medium' },
  { oil: 'butter', amount: 'more', label: 'バターたっぷり・強火10秒→弱火', heat: 'high', heatAt: [[10, 'low']] },
  { oil: 'butter', amount: 'normal', label: 'バター・弱火', heat: 'low' },
  { oil: 'salad', amount: 'normal', label: '中火→20秒で差し水＋ふた', heat: 'medium', waterAt: 20, lidAt: 20 },
  { oil: 'salad', amount: 'less', label: '少なめ・中火→差し水＋ふた→20秒で弱火', heat: 'medium', waterAt: 15, lidAt: 15, heatAt: [[20, 'low']] },
  { oil: 'salad', amount: 'more', label: 'たっぷり・中火35秒→差し水＋ふた', heat: 'medium', waterAt: 35, lidAt: 35 },
  { oil: 'sesame', amount: 'more', label: 'ごま油たっぷり・中火30秒→差し水＋ふた', heat: 'medium', waterAt: 30, lidAt: 30 },
];

export interface ComboBest {
  egg: EggConfig;
  target: TargetConfig;
  edge: EdgeTargetConfig;
  best: number;
  plan: Plan;
  at: number;
  basicBest: number;
}

/** 全27条件について、手順の見本の中での最高点を求めます */
export function bestForAll(plans: Plan[] = [...BASIC_PLANS, ...TECHNIQUE_PLANS]): ComboBest[] {
  const out: ComboBest[] = [];
  for (const egg of GAME_CONFIG.eggs) {
    for (const target of GAME_CONFIG.targets) {
      for (const edge of GAME_CONFIG.edgeTargets) {
        let best = -1;
        let bestPlan = plans[0];
        let at = 0;
        let basicBest = -1;
        for (const plan of plans) {
          const w = scanPlan(egg, target, edge, plan);
          if (w.best > best) {
            best = w.best;
            bestPlan = plan;
            at = w.bestAt;
          }
          if (BASIC_PLANS.includes(plan)) basicBest = Math.max(basicBest, w.best);
        }
        out.push({ egg, target, edge, best, plan: bestPlan, at, basicBest });
      }
    }
  }
  return out;
}

const sec = (step: number | null) => (step === null ? '-' : (step / STEPS_PER_SECOND).toFixed(1) + 's');

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`scoringVersion ${GAME_CONFIG.scoringVersion}`);
  console.log('\n■ はじめの1皿（サラダ油・ふつう・差し水なし・縁ほんのり）');
  const golden = getEdge('golden');
  for (const egg of GAME_CONFIG.eggs) {
    for (const target of GAME_CONFIG.targets) {
      const cells = BASIC_PLANS.slice(0, 4).map((p) => {
        const w = scanPlan(egg, target, golden, p);
        return `${p.label}: 最高${w.best}点@${sec(w.bestAt)} 90点以上[${sec(w.from)}〜${sec(w.to)}]`;
      });
      console.log(`${egg.name} × ${target.label}\n  ${cells.join('\n  ')}`);
    }
  }
  console.log('\n■ 全27条件の最高点（手順の見本から）  ※「基本のみ」はサラダ油・ふつう・差し水なしの手順だけの最高点');
  for (const r of bestForAll()) {
    console.log(
      `${r.egg.name} × ${r.target.label} × 縁${r.edge.label}: ${r.best}点@${sec(r.at)}（${r.plan.label}）  基本のみ ${r.basicBest}点`,
    );
  }
  // 強火で放置した場合
  const s = initialCookState();
  s.heat = 'high';
  const p = cookParams({ eggId: 'white', oilId: DEFAULT_OIL, oilAmountId: DEFAULT_OIL_AMOUNT });
  while (s.step < MAX_STEPS) stepCook(s, p);
  const sc = scoreCook(s, 0.38, golden);
  console.log(`\n強火で90秒放置（白い卵・とろり・ほんのり）: ${sc.score}点 D=${s.D.toFixed(2)} cap=${sc.cap?.kind ?? 'なし'}`);
}
