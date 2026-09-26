// 採点チューニングの確認用シミュレーション。
// 実行: node scripts/simulate.ts
// 設定値（config/game-config.json）だけで調整し、全9条件で90点以上が取れるかを確認します。
import { GAME_CONFIG, STEPS_PER_SECOND, MAX_STEPS, type EggConfig, type HeatLevel, type TargetConfig } from '../shared/config.ts';
import { initialCookState, scoreCook, stepCook } from '../shared/model.ts';

interface Strategy {
  label: string;
  heat: HeatLevel;
  lidClosed: boolean;
}

const strategies: Strategy[] = [
  { label: '中火・ふた開', heat: 'medium', lidClosed: false },
  { label: '中火・ふた閉', heat: 'medium', lidClosed: true },
  { label: '弱火・ふた閉', heat: 'low', lidClosed: true },
  { label: '強火・ふた開', heat: 'high', lidClosed: false },
];

export interface Window {
  best: number;
  bestAt: number;
  from: number | null;
  to: number | null;
}

/** 一定の火力・ふたで焼き続け、各stepでお皿にうつした場合の点数を調べる */
export function scan(egg: EggConfig, target: TargetConfig, st: Strategy): Window {
  const s = initialCookState();
  s.heat = st.heat;
  s.lidClosed = st.lidClosed;
  let best = -1;
  let bestAt = 0;
  let from: number | null = null;
  let to: number | null = null;
  while (s.step < MAX_STEPS) {
    stepCook(s, egg.gameSpeed);
    const sc = scoreCook(s, target.targetY).score;
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

const sec = (step: number | null) => (step === null ? '-' : (step / STEPS_PER_SECOND).toFixed(1) + 's');

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`scoringVersion ${GAME_CONFIG.scoringVersion}`);
  for (const egg of GAME_CONFIG.eggs) {
    for (const target of GAME_CONFIG.targets) {
      const cells = strategies.map((st) => {
        const w = scan(egg, target, st);
        return `${st.label}: 最高${w.best}点@${sec(w.bestAt)} 90点以上[${sec(w.from)}〜${sec(w.to)}]`;
      });
      console.log(`${egg.name} × ${target.label}\n  ${cells.join('\n  ')}`);
    }
  }
  // 強火で放置した場合
  const s = initialCookState();
  s.heat = 'high';
  while (s.step < MAX_STEPS) stepCook(s, 1);
  const sc = scoreCook(s, 0.38);
  console.log(`強火で90秒放置（白い卵・とろり）: ${sc.score}点 D=${s.D.toFixed(2)} cap=${sc.cap?.kind ?? 'なし'}`);
}
