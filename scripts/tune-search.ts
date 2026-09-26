// 採点チューニング用の探索。卵×黄身×縁の各組み合わせについて、油・火かげん・ふた・差し水の
// 手順を総当たりし、最高点と「90点以上を保てる時間の長さ」を調べます。
// 使い方: node scripts/tune-search.ts   （数十秒かかります）
import { GAME_CONFIG, MAX_STEPS, STEPS_PER_SECOND, cookParams, type EggId, type HeatLevel, type OilAmountId, type OilId } from '../shared/config.ts';
import { addWater, initialCookState, scoreCook, stepCook } from '../shared/model.ts';

interface Plan { oil: OilId; amount: OilAmountId; h1: HeatLevel; t1: number; h2: HeatLevel; lidAt: number | null; waterAt: number | null }
interface Best { score: number; window: number; plan: Plan | null; at: number; windowPlan: Plan | null; windowScore: number; windowAt: number }

const eggs: EggId[] = (process.env.EGGS?.split(',') as EggId[]) ?? ['white', 'quail'];
const targets = GAME_CONFIG.targets;
const edges = GAME_CONFIG.edgeTargets;
const oils = GAME_CONFIG.oils.map((o) => o.id);
const amounts = GAME_CONFIG.oilAmounts.map((a) => a.id);
const HS: HeatLevel[] = ['low', 'medium', 'high'];
const H2: HeatLevel[] = ['off', 'low', 'medium', 'high'];
const T1 = [5, 10, 15, 20, 30, 40, 90];
const LID = [null, 0, 10, 20, 30, 40, 50, 60];
const WATER = [null, 10, 20, 30, 40, 50, 60, 70];
const EVAL_EVERY = 6;

export function searchAll(filterOil?: (p: Plan) => boolean) {
  const results = new Map<string, Best>();
  for (const egg of eggs) {
    for (const oil of oils) for (const amount of amounts) {
      const params = cookParams({ eggId: egg, oilId: oil, oilAmountId: amount });
      for (const h1 of HS) for (const t1 of T1) for (const h2 of (t1 === 90 ? [h1] : H2)) for (const lidAt of LID) for (const waterAt of WATER) {
        const plan: Plan = { oil, amount, h1, t1, h2, lidAt, waterAt };
        if (filterOil && !filterOil(plan)) continue;
        const s = initialCookState();
        s.heat = h1;
        const runLen = new Map<string, number>();
        for (let step = 0; step < MAX_STEPS; step++) {
          const sec = step / STEPS_PER_SECOND;
          if (step === t1 * STEPS_PER_SECOND) s.heat = h2;
          if (lidAt !== null && step === lidAt * STEPS_PER_SECOND) s.lidClosed = true;
          if (waterAt !== null && step === waterAt * STEPS_PER_SECOND) addWater(s);
          stepCook(s, params);
          if (s.D >= 0.5) break;
          if (step % EVAL_EVERY) continue;
          for (const t of targets) for (const e of edges) {
            const key = `${egg}|${t.id}|${e.id}`;
            const sc = scoreCook(s, t.targetY, e).score;
            let b = results.get(key);
            if (!b) { b = { score: 0, window: 0, plan: null, at: 0, windowPlan: null, windowScore: 0, windowAt: 0 }; results.set(key, b); }
            if (sc > b.score) { b.score = sc; b.plan = plan; b.at = sec; }
            const rl = sc >= 90 ? (runLen.get(key) ?? 0) + EVAL_EVERY / STEPS_PER_SECOND : 0;
            runLen.set(key, rl);
            if (rl > b.window) { b.window = rl; b.windowPlan = plan; b.windowScore = sc; b.windowAt = sec; }
          }
        }
      }
    }
  }
  return results;
}

const fmt = (p: Plan | null) => p ? `${p.oil}/${p.amount} ${p.h1}${p.t1 < 90 ? `→${p.t1}s→${p.h2}` : ''}${p.lidAt !== null ? ` lid@${p.lidAt}` : ''}${p.waterAt !== null ? ` water@${p.waterAt}` : ''}` : '-';
if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const r = searchAll();
  for (const [k, b] of [...r.entries()].sort()) {
    console.log(`${k.padEnd(22)} best ${b.score}@${b.at.toFixed(1)}s [${fmt(b.plan)}]  window90 ${b.window.toFixed(1)}s [${fmt(b.windowPlan)} end@${b.windowAt.toFixed(1)}]`);
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
