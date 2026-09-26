// X（旧Twitter）の投稿画面を開くためのテキストとURL。
// 投稿は必ずユーザー自身がXの画面で確定します。ローカル画像の自動添付はできません。

export interface ShareTextInput {
  score: number;
  eggName: string;
  targetLabel: string;
  title: string;
}

export const FIXED_HASHTAGS = ['目玉焼きチャレンジ'];

export function buildShareText(r: ShareTextInput): string {
  return `目玉焼き、今日は${r.score}点！\n${r.eggName} × ${r.targetLabel}で「${r.title}」\nあなたは何点？`;
}

export function buildHashtags(primary: string): string[] {
  const tags = [primary.replace(/^#/, '').trim(), ...FIXED_HASHTAGS].filter(Boolean);
  return Array.from(new Set(tags));
}

/** https://x.com/intent/tweet に text / url / hashtags を URLSearchParams で設定します。URLが空なら付けません。 */
export function buildXIntentUrl(text: string, url: string, hashtags: string[]): string {
  const p = new URLSearchParams();
  p.set('text', text);
  if (url) p.set('url', url);
  if (hashtags.length) p.set('hashtags', hashtags.map((h) => h.replace(/^#/, '')).join(','));
  return `https://x.com/intent/tweet?${p.toString()}`;
}

/** 結果の文をコピーするとき用（ハッシュタグとURLを本文に含める） */
export function buildCopyText(text: string, url: string, hashtags: string[]): string {
  return [text, hashtags.map((h) => `#${h}`).join(' '), url].filter(Boolean).join('\n');
}
