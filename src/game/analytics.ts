// 計測イベント。外部サービスには送らず、window.dataLayer（あれば）とカスタムイベントに流すだけです。
// 運用する計測サービスと保存期間は公開前に決め、案内ページに反映してください。
// 名称は「開いた」「クリックした」であり、投稿・保存・購入の成功を意味しません。

export type AnalyticsEvent =
  | 'game_start'
  | 'egg_select'
  | 'game_complete'
  | 'replay_start'
  | 'result_image_save_click'
  | 'x_intent_open'
  | 'native_share_open'
  | 'leaderboard_publish'
  | 'sponsor_click';

const completedRuns = new Set<string>();

export function track(name: AnalyticsEvent, props: Record<string, string | number | boolean | null> = {}): void {
  if (name === 'game_complete') {
    const key = String(props.runKey ?? '');
    if (key && completedRuns.has(key)) return; // 同じrunの完了は一度だけ
    if (key) completedRuns.add(key);
  }
  const payload = { event: name, ...props };
  try {
    const w = window as unknown as { dataLayer?: unknown[] };
    if (Array.isArray(w.dataLayer)) w.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('tamago:analytics', { detail: payload }));
  } catch {
    /* noop */
  }
  if (import.meta.env.DEV) console.debug('[analytics]', payload);
}
