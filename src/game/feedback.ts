// 結果の見出し・一言・調理中の観察ラベル。
// 一言は失点原因から選びます（優先順：白身不足→強い焦げ→黄身の不足/過剰→焼き色）。
// ラベルはゲーム内の目安で、現実の安全判定ではありません。
import { GAME_CONFIG } from '../../shared/config.ts';
import type { FinalCook, ScoreBreakdown } from '../../shared/model.ts';

export function scoreTitle(score: number): string {
  if (score >= 90) return '理想のひと皿！';
  if (score >= 75) return 'いい焼き上がり！';
  if (score >= 50) return 'もうひと息！';
  return '次の一個で、もう一度。';
}

export type FeedbackCause = 'white' | 'burn' | 'yolkUnder' | 'yolkOver' | 'brownUnder' | 'brownOver' | 'none';

export function feedbackCause(f: FinalCook, b: ScoreBreakdown, targetY: number): FeedbackCause {
  const sc = GAME_CONFIG.score;
  if (f.W < sc.rawWhiteThreshold || b.whiteFit < 0.97) return 'white';
  if (f.D >= 0.12 || b.afterBurn < b.base - 4) return 'burn';
  if (b.yolkFit < 0.97) return f.Y < targetY ? 'yolkUnder' : 'yolkOver';
  if (b.brownFit < 0.9) return f.B < sc.brownTarget ? 'brownUnder' : 'brownOver';
  return 'none';
}

export function feedbackComment(cause: FeedbackCause): string {
  switch (cause) {
    case 'white':
      return '白身が白くなってから仕上げよう。';
    case 'burn':
      return '縁が焦げはじめ。火を少し弱めてみよう。';
    case 'yolkUnder':
      return '黄身はもう少し待って。ふたをすると黄身が進みやすい。';
    case 'yolkOver':
      return '次は少し早めにお皿へ。';
    case 'brownUnder':
      return '縁の焼き色は、中火くらいで少しずつ。';
    case 'brownOver':
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
