import type { EggConfig, EggId, TargetConfig, TargetId } from '../shared/config.ts';
import type { EggShape } from '../shared/shape.ts';
import type { PublishResponse, RunTicket, VerifiedResult } from '../shared/api-types.ts';
import type { FinalResult } from './game/session.ts';
import type { LocalBest } from './game/storage.ts';

export type ScreenName = 'title' | 'select' | 'play' | 'result' | 'ranking' | 'settings';

export interface Selection {
  eggId: EggId;
  targetId: TargetId;
}

export type LocalReason = 'not_configured' | 'offline';

export interface RunInfo {
  key: string;
  seed: number;
  selection: Selection;
  ticket: RunTicket | null;
  localReason: LocalReason | null;
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
  shape: EggShape;
  final: FinalResult;
  finishedAt: number;
  best: { isNewBest: boolean; previous: LocalBest | null };
  storagePersistent: boolean;
}
