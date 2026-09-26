// ランキングAPIの入出力の型（ブラウザとサーバーで共有）。
import type { EdgeId, EggId, OilAmountId, OilId, TargetId } from './config.ts';
import type { CookEvent } from './events.ts';

export interface SessionResponse {
  token: string;
}

export interface RunRequest {
  eggId: EggId;
  targetId: TargetId;
  edgeId: EdgeId;
  oilId: OilId;
  oilAmountId: OilAmountId;
}

export interface RunTicket {
  runId: string;
  seed: number;
  scoringVersion: string;
  eggId: EggId;
  targetId: TargetId;
  edgeId: EdgeId;
  oilId: OilId;
  oilAmountId: OilAmountId;
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
  edgeId: EdgeId;
  oilId: OilId;
  oilAmountId: OilAmountId;
  /** 差し水をしたstep（しなかったらnull） */
  waterStep: number | null;
  scoringVersion: string;
  W: number;
  Y: number;
  B: number;
  D: number;
  wet: number;
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

/** その記録で使った道具（ランキングで「どう焼いたか」を見せるため） */
export interface Technique {
  oilId: OilId;
  oilAmountId: OilAmountId;
  /** 差し水をした秒（しなかったらnull） */
  waterAtSeconds: number | null;
  /** お皿にうつした秒 */
  plateAtSeconds: number;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  score: number;
  verifiedAt: number;
  isMe: boolean;
  technique: Technique;
}

export interface LeaderboardResponse {
  scoringVersion: string;
  eggId: EggId;
  targetId: TargetId;
  edgeId: EdgeId;
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
