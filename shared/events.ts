// 操作ログ（整数stepで記録）と、その検証・再生。
// ブラウザは操作時にログを記録し、サーバーは同じ関数で初期状態から再生して点数を確定します。
import { GAME_CONFIG, MAX_STEPS, isHeatLevel, type GameConfig, type HeatLevel } from './config.ts';
import { initialCookState, stepCook, type CookState } from './model.ts';

export type LidValue = 'open' | 'closed';

export type CookEvent =
  | { seq: number; step: number; action: 'heat'; value: HeatLevel }
  | { seq: number; step: number; action: 'lid'; value: LidValue };

export const MAX_EVENTS = 500;
/** 重複除去前に受け付ける最大件数（通信量の上限）。 */
export const MAX_RAW_EVENTS = 2000;

export function applyEvent(s: CookState, e: CookEvent): void {
  if (e.action === 'heat') s.heat = e.value;
  else s.lidClosed = e.value === 'closed';
}

/**
 * ログを初期状態から再生し、stopStepまで進めた状態を返します。
 * stepがnのイベントは「nステップ完了後、次のステップを計算する前」に適用します。
 * 同じstepに複数ある場合はseq順です（呼び出し側でseq順に並んでいる前提）。
 */
export function replay(events: readonly CookEvent[], stopStep: number, eggSpeed: number, cfg: GameConfig = GAME_CONFIG): CookState {
  const s = initialCookState(cfg);
  let i = 0;
  const end = Math.min(stopStep, MAX_STEPS);
  while (s.step < end) {
    while (i < events.length && events[i].step <= s.step) {
      applyEvent(s, events[i]);
      i++;
    }
    stepCook(s, eggSpeed, cfg);
  }
  // stopStepちょうどのイベントは点数に影響しないが、状態表示の整合のため適用しておく
  while (i < events.length && events[i].step <= s.step) {
    applyEvent(s, events[i]);
    i++;
  }
  return s;
}

export type LogValidationError =
  | 'not_array'
  | 'too_many_raw_events'
  | 'bad_event'
  | 'bad_seq'
  | 'bad_step'
  | 'step_decreasing'
  | 'bad_action'
  | 'bad_value'
  | 'too_many_events'
  | 'bad_stop_step'
  | 'stop_before_last_event';

export type ValidatedLog = { ok: true; events: CookEvent[]; stopStep: number } | { ok: false; error: LogValidationError };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * 外部から受け取ったログを検証し、同じ値の連続（状態が変わらない操作）を除去して返します。
 * seqは0からの連番、stepは0〜5400の整数で非減少、actionはheat/lidのみ。
 */
export function validateLog(input: unknown, stopStepInput: unknown): ValidatedLog {
  if (!Array.isArray(input)) return { ok: false, error: 'not_array' };
  if (input.length > MAX_RAW_EVENTS) return { ok: false, error: 'too_many_raw_events' };
  if (!isInt(stopStepInput) || stopStepInput < 0 || stopStepInput > MAX_STEPS) return { ok: false, error: 'bad_stop_step' };

  const parsed: CookEvent[] = [];
  let prevStep = 0;
  for (let i = 0; i < input.length; i++) {
    const e = input[i] as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: 'bad_event' };
    const keys = Object.keys(e);
    if (keys.some((k) => !['seq', 'step', 'action', 'value'].includes(k))) return { ok: false, error: 'bad_event' };
    if (!isInt(e.seq) || e.seq !== i) return { ok: false, error: 'bad_seq' };
    if (!isInt(e.step) || e.step < 0 || e.step > MAX_STEPS) return { ok: false, error: 'bad_step' };
    if (e.step < prevStep) return { ok: false, error: 'step_decreasing' };
    prevStep = e.step;
    if (e.action === 'heat') {
      if (!isHeatLevel(e.value)) return { ok: false, error: 'bad_value' };
      parsed.push({ seq: e.seq, step: e.step, action: 'heat', value: e.value });
    } else if (e.action === 'lid') {
      if (e.value !== 'open' && e.value !== 'closed') return { ok: false, error: 'bad_value' };
      parsed.push({ seq: e.seq, step: e.step, action: 'lid', value: e.value });
    } else {
      return { ok: false, error: 'bad_action' };
    }
  }
  const stopStep = stopStepInput;
  if (parsed.length > 0 && stopStep < parsed[parsed.length - 1].step) return { ok: false, error: 'stop_before_last_event' };

  const events = dedupeEvents(parsed);
  if (events.length > MAX_EVENTS) return { ok: false, error: 'too_many_events' };
  return { ok: true, events, stopStep };
}

/** 状態を変えないイベント（同じ値の連続）を取り除き、seqを振り直します。 */
export function dedupeEvents(events: readonly CookEvent[]): CookEvent[] {
  let heat: HeatLevel = 'medium';
  let lid: LidValue = 'open';
  const out: CookEvent[] = [];
  for (const e of events) {
    if (e.action === 'heat') {
      if (e.value === heat) continue;
      heat = e.value;
    } else {
      if (e.value === lid) continue;
      lid = e.value;
    }
    out.push({ ...e, seq: out.length } as CookEvent);
  }
  return out;
}

/** ログの同一性確認用の正規化文字列（再送判定に使用）。 */
export function canonicalLog(events: readonly CookEvent[], stopStep: number): string {
  return JSON.stringify({ stopStep, events: events.map((e) => [e.step, e.action, e.value]) });
}
