// 1回のプレイ（卵を割る→調理→お皿へ）を進める描画非依存のドライバー。
// 描画のフレーム間隔に関係なく、固定ステップ（1/60秒）でモデルを進めます。
import { GAME_CONFIG, MAX_STEPS, getEgg, getTarget, type EggConfig, type EggId, type HeatLevel, type TargetConfig, type TargetId } from '../../shared/config.ts';
import { cloneCookState, initialCookState, scoreCook, stepCook, type CookState, type ScoreBreakdown } from '../../shared/model.ts';
import type { CookEvent } from '../../shared/events.ts';
import tokens from '../../config/design-tokens.json' with { type: 'json' };

export type PlayPhase = 'crackReady' | 'cracked' | 'drop' | 'cooking' | 'plating' | 'done';

/** 殻が開いてパンに着地するまで（0.8秒） */
export const DROP_MS = tokens.motion.crackMs;
/** お皿にうつす演出（0.8秒） */
export const PLATING_MS = tokens.motion.plateMs;
/** 1フレームで取り込む実時間の上限。長い停止の差分をまとめて加算しないため。 */
export const MAX_FRAME_SECONDS = 0.25;
/** 2回目のタップを受け付けるまでの最短間隔（1回の物理タップの二重発火対策） */
export const MIN_TAP_INTERVAL_MS = 120;

const STEP = GAME_CONFIG.fixedStepSeconds;
const EPS = 1e-9;

export type StopReason = 'plate' | 'timeout';

export interface FinalResult {
  cook: CookState;
  breakdown: ScoreBreakdown;
  stopStep: number;
  events: CookEvent[];
  reason: StopReason;
}

export interface TickOutcome {
  steps: number;
  landed: boolean;
  stopped: StopReason | null;
  platingDone: boolean;
}

export class PlaySession {
  readonly egg: EggConfig;
  readonly target: TargetConfig;
  readonly seed: number;
  phase: PlayPhase = 'crackReady';
  phaseStartedAt: number;
  paused = false;
  cook: CookState;
  readonly events: CookEvent[] = [];
  final: FinalResult | null = null;
  private acc = 0;
  private lastTapAt = -Infinity;

  constructor(eggId: EggId, targetId: TargetId, seed: number, now: number) {
    this.egg = getEgg(eggId);
    this.target = getTarget(targetId);
    this.seed = seed;
    this.phaseStartedAt = now;
    this.cook = initialCookState();
  }

  get eggId(): EggId {
    return this.egg.id;
  }

  get targetId(): TargetId {
    return this.target.id;
  }

  /** 経過秒（着地から）。停止中・一時停止中は増えません。 */
  get elapsedSeconds(): number {
    return this.cook.step * STEP;
  }

  private setPhase(p: PlayPhase, now: number): void {
    this.phase = p;
    this.phaseStartedAt = now;
  }

  /** 卵へのタップ。1回目でひび、2回目で割る。落下中などは無視して false を返します。 */
  tapEgg(now: number): boolean {
    if (now - this.lastTapAt < MIN_TAP_INTERVAL_MS) return false;
    if (this.phase === 'crackReady') {
      this.lastTapAt = now;
      this.setPhase('cracked', now);
      return true;
    }
    if (this.phase === 'cracked') {
      this.lastTapAt = now;
      this.setPhase('drop', now);
      return true;
    }
    return false;
  }

  get canOperate(): boolean {
    return this.phase === 'cooking' && !this.paused && this.final === null;
  }

  setHeat(level: HeatLevel): boolean {
    if (!this.canOperate || this.cook.heat === level) return false;
    this.cook.heat = level;
    this.events.push({ seq: this.events.length, step: this.cook.step, action: 'heat', value: level });
    return true;
  }

  setLid(closed: boolean): boolean {
    if (!this.canOperate || this.cook.lidClosed === closed) return false;
    this.cook.lidClosed = closed;
    this.events.push({ seq: this.events.length, step: this.cook.step, action: 'lid', value: closed ? 'closed' : 'open' });
    return true;
  }

  /** お皿にうつす。モデルを即時固定して採点します（一度だけ）。 */
  plate(now: number): boolean {
    if (!this.canOperate) return false;
    this.stop('plate', now);
    return true;
  }

  private stop(reason: StopReason, now: number): void {
    if (this.final) return;
    const cook = cloneCookState(this.cook);
    this.final = {
      cook,
      breakdown: scoreCook(cook, this.target.targetY),
      stopStep: cook.step,
      events: this.events.map((e) => ({ ...e })),
      reason,
    };
    this.acc = 0;
    this.setPhase('plating', now);
  }

  pause(): void {
    if (this.phase === 'cooking' && this.final === null) this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.acc = 0; // 止まっていた時間は加算しない
  }

  /**
   * 描画フレームごとに呼びます。realDtSecondsは前フレームからの実時間。
   * 調理中は固定ステップでモデルを進め、演出フェーズは実時間で遷移します。
   */
  tick(now: number, realDtSeconds: number): TickOutcome {
    const out: TickOutcome = { steps: 0, landed: false, stopped: null, platingDone: false };
    if (this.phase === 'drop' && now - this.phaseStartedAt >= DROP_MS) {
      this.setPhase('cooking', now);
      this.acc = 0;
      out.landed = true;
      return out;
    }
    if (this.phase === 'cooking' && !this.paused && this.final === null) {
      this.acc += Math.min(Math.max(realDtSeconds, 0), MAX_FRAME_SECONDS);
      while (this.acc + EPS >= STEP && this.cook.step < MAX_STEPS) {
        this.acc -= STEP;
        stepCook(this.cook, this.egg.gameSpeed);
        out.steps++;
      }
      if (this.cook.step >= MAX_STEPS) {
        this.stop('timeout', now);
        out.stopped = 'timeout';
      }
      return out;
    }
    if (this.phase === 'plating' && now - this.phaseStartedAt >= PLATING_MS) {
      this.setPhase('done', now);
      out.platingDone = true;
    }
    return out;
  }
}

export { MAX_STEPS };
