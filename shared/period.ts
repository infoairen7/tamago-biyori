// ランキングの週区切り：日本時間（Asia/Tokyo, UTC+9、夏時間なし）の月曜00:00〜次の月曜00:00。
// DBにはUTCのエポックミリ秒で保存し、判定と表示は日本時間で行います。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** 指定時刻が属する週の開始（日本時間 月曜00:00）をUTCエポックミリ秒で返します。 */
export function jstWeekStart(utcMs: number): number {
  const jst = utcMs + JST_OFFSET_MS;
  const dayIndex = Math.floor(jst / DAY_MS); // 1970-01-01(木)からの日数（JST）
  const weekday = (dayIndex + 3) % 7; // 0=月曜
  const mondayJst = (dayIndex - weekday) * DAY_MS;
  return mondayJst - JST_OFFSET_MS;
}

export interface JstDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0=日曜
}

export function jstParts(utcMs: number): JstDateParts {
  const d = new Date(utcMs + JST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 「9/21（月）〜9/27（日）」形式。endは排他的な終端（次の月曜00:00）。 */
export function formatJstRange(startUtcMs: number, endUtcMsExclusive: number): string {
  const a = jstParts(startUtcMs);
  const b = jstParts(endUtcMsExclusive - 1);
  return `${a.month}/${a.day}（${WEEKDAYS_JA[a.weekday]}）〜${b.month}/${b.day}（${WEEKDAYS_JA[b.weekday]}）`;
}

export function formatJstDateTime(utcMs: number): string {
  const d = new Date(utcMs + JST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
