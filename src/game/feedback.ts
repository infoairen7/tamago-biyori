// 結果の見出し・一言・調理中の観察ラベル。
// 一言は失点原因から選びます（優先順：白身不足→強い焦げ→黄身の不足/過剰→焼き色）。
// ラベルはゲーム内の目安で、現実の安全判定ではありません。
import { GAME_CONFIG } from '../../shared/config.ts';
import type { FinalCook, ScoreBreakdown } from '../../shared/model.ts';
import type { EdgeTargetConfig, OilAmountConfig, OilConfig } from '../../shared/config.ts';

export function scoreTitle(score: number): string {
  if (score >= 90) return '理想のひと皿！';
  if (score >= 75) return 'いい焼き上がり！';
  if (score >= 50) return 'もうひと息！';
  return '次の一個で、もう一度。';
}

export type FeedbackCause = 'white' | 'burn' | 'wet' | 'yolkUnder' | 'yolkOver' | 'brownUnder' | 'brownOver' | 'none';

export interface FeedbackContext {
  targetY: number;
  edge: EdgeTargetConfig;
  oil: OilConfig;
  amount: OilAmountConfig;
  /** 差し水をしたか */
  waterUsed: boolean;
  /** 差し水・油の種類・油の量を選べる状態か（まだ解放前の道具はすすめない） */
  unlocks: { water: boolean; oilType: boolean; oilAmount: boolean };
}

export function feedbackCause(f: FinalCook, b: ScoreBreakdown, ctx: Pick<FeedbackContext, 'targetY' | 'edge'>): FeedbackCause {
  const sc = GAME_CONFIG.score;
  if (f.W < sc.rawWhiteThreshold || b.whiteFit < 0.97) return 'white';
  if (f.D >= 0.12 || b.afterBurn < b.base - 4) return 'burn';
  if ((f.wet ?? 0) >= 0.15) return 'wet';
  if (b.yolkFit < 0.97) return f.Y < ctx.targetY ? 'yolkUnder' : 'yolkOver';
  if (b.brownFit < 0.9) return f.B < ctx.edge.targetB ? 'brownUnder' : 'brownOver';
  return 'none';
}

/** 失点の原因と、選んだ道具に合わせた次の一手。ブランドや卵の良し悪しには触れません。 */
export function feedbackComment(cause: FeedbackCause, ctx: FeedbackContext): string {
  const { edge, oil, amount, waterUsed, unlocks } = ctx;
  switch (cause) {
    case 'white':
      return '白身が白くなってから仕上げよう。';
    case 'burn':
      if (oil.id === 'butter') return 'バターは焦げやすい油。中火より弱めにするか、差し水で温度を下げよう。';
      if (amount.id === 'less') return '油が少ないと焦げつきやすい。油を増やすか、火を弱めてみよう。';
      return '縁が焦げはじめ。火を少し弱めてみよう。';
    case 'wet':
      return '差し水が早すぎて、白身が水っぽく。縁が白くなってから差そう。';
    case 'yolkUnder':
      if (unlocks.water && !waterUsed) return '黄身はもう少し。仕上げに差し水＋ふたで、黄身だけ進められる。';
      return '黄身はもう少し待って。ふたをすると黄身が進みやすい。';
    case 'yolkOver':
      if (waterUsed) return '蒸気で黄身が進みすぎたかも。差し水は少し遅めに。';
      return '次は少し早めにお皿へ。';
    case 'brownUnder':
      if (edge.id === 'crispy') {
        if (unlocks.oilAmount && amount.id !== 'more') return '油をたっぷりにすると、縁がカリッとしやすい。';
        if (unlocks.oilType && oil.id === 'salad') return 'ごま油やバターは色づきやすい。カリッとさせたいときに。';
        return '縁をカリッとさせるには、中火以上でじっくり。';
      }
      return '縁の焼き色は、中火くらいで少しずつ。';
    case 'brownOver':
      if (edge.id === 'pale') {
        if (unlocks.water && !waterUsed) return '焼き色をつけたくないときは、差し水＋ふたの蒸し焼きか、弱火でじっくり。';
        return '焼き色をつけたくないときは、弱火でじっくり。ふたも効きます。';
      }
      if (amount.id === 'more') return '油たっぷりは色づきやすい。量を減らすか、ふたで抑えてみよう。';
      return '縁が色づきすぎ。ふたや弱火で調整してみよう。';
    case 'none':
      return '白身と黄身、いいバランス。';
  }
}

export function whiteLabel(W: number): string {
  if (W < 0.4) return 'まだ透明';
  if (W < 0.75) return '白くなってきた';
  return '固まってきた';
}

export function yolkLabel(Y: number): string {
  if (Y < 0.45) return 'とろり';
  if (Y < 0.75) return '固まりはじめ';
  return 'しっかり';
}

export function edgeLabel(B: number, D: number): string {
  if (D >= 0.08) return '焦げはじめ';
  if (B < 0.06) return '白いまま';
  if (B < 0.3) return 'きつね色';
  if (B < 0.58) return 'こんがり';
  return '濃いめ';
}

export function panMood(W: number, D: number): string {
  if (D >= 0.08) return '縁が焦げはじめた。';
  if (W < 0.4) return 'じゅわっと、焼きはじめ。';
  if (W < 0.75) return '白身が変わってきた。';
  return 'よく見て、お皿へ。';
}

export const HEAT_LABELS = { off: '切', low: '弱', medium: '中', high: '強' } as const;
export const HEAT_STATUS = {
  off: '火を切っています（余熱あり）',
  low: '弱火で調理中',
  medium: '中火で調理中',
  high: '強火で調理中',
} as const;
