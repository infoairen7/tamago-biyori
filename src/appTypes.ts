import type { EdgeTargetConfig, EggConfig, OilAmountConfig, OilConfig, Recipe, TargetConfig } from '../shared/config.ts';
import type { EggShape } from '../shared/shape.ts';
import type { PublishResponse, RunTicket, VerifiedResult } from '../shared/api-types.ts';
import type { FinalResult } from './game/session.ts';
import type { Feature, LocalBest, Unlocks } from './game/storage.ts';

export type ScreenName = 'title' | 'select' | 'play' | 'result' | 'ranking' | 'settings';

/** 焼く前に選んだ内容（卵・黄身・縁・油） */
export type Selection = Recipe;

export type LocalReason = 'not_configured' | 'offline';

export interface RunInfo {
  key: string;
  seed: number;
  selection: Selection;
  ticket: RunTicket | null;
  localReason: LocalReason | null;
  /** 焼き始めた時点で使えたこだわり */
  unlocks: Unlocks;
}

export type OnlineState =
  | { kind: 'local'; reason: LocalReason | 'expired' | 'rejected'; message?: string }
  | { kind: 'pending' }
  | { kind: 'verified'; result: VerifiedResult; published: PublishResponse | null }
  | { kind: 'failed'; message: string };

export interface GameResult {
  run: RunInfo;
  egg: EggConfig;
  target: TargetConfig;
  edge: EdgeTargetConfig;
  oil: OilConfig;
  amount: OilAmountConfig;
  shape: EggShape;
  final: FinalResult;
  finishedAt: number;
  best: { isNewBest: boolean; previous: LocalBest | null };
  storagePersistent: boolean;
  /** この1皿で新しく使えるようになったこだわり */
  newlyUnlocked: Feature[];
}
