// ランキングAPIの入出力の型（ブラウザとサーバーで共有）。
import type { EggId, TargetId } from './config.ts';
import type { CookEvent } from './events.ts';

export interface SessionResponse {
  token: string;
}

export interface RunRequest {
  eggId: EggId;
  targetId: TargetId;
}

export interface RunTicket {
  runId: string;
  seed: number;
  scoringVersion: string;
  eggId: EggId;
  targetId: TargetId;
  startedAt: number;
  expiresAt: number;
}

export interface FinishRequest {
  events: CookEvent[];
  stopStep: number;
}

export interface VerifiedResult {
  resultId: string;
  runId: string;
  eggId: EggId;
  targetId: TargetId;
  scoringVersion: string;
  W: number;
  Y: number;
  B: number;
  D: number;
  score: number;
  stopStep: number;
  verifiedAt: number;
  weekStart: number;
  publishedAt: number | null;
  displayName: string | null;
}

export interface PublishRequest {
  displayName: string;
}

export interface RankInfo {
  rank: number;
  score: number;
  total: number;
}

export interface PublishResponse {
  result: VerifiedResult;
  weekly: RankInfo | null;
  allTime: RankInfo | null;
  fetchedAt: number;
}

export type Period = 'weekly' | 'all';

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  score: number;
  verifiedAt: number;
  isMe: boolean;
}

export interface LeaderboardResponse {
  scoringVersion: string;
  eggId: EggId;
  targetId: TargetId;
  period: Period;
  /** 週間のときの期間（UTCエポックミリ秒、endは排他的） */
  range: { start: number; end: number } | null;
  entries: LeaderboardEntry[];
  me: RankInfo | null;
  total: number;
  fetchedAt: number;
}

export interface ApiError {
  error: string;
  message: string;
}
