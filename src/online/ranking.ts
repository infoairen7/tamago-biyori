// ランキングAPIのクライアント。VITE_API_BASE が未設定なら「未接続」として扱い、
// 架空のデータで埋めずに「ランキングに接続できません」を表示します。
import type { EdgeId, EggId, Recipe, TargetId } from '../../shared/config.ts';
import type { CookEvent } from '../../shared/events.ts';
import type { LeaderboardResponse, Period, PublishResponse, RunTicket, VerifiedResult } from '../../shared/api-types.ts';
import { getPlayerToken, savePlayerToken } from '../game/storage.ts';

export class RankingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function resolveBase(): string | null {
  const raw = (import.meta.env.VITE_API_BASE ?? '').trim();
  if (!raw) return null;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export class RankingClient {
  private base: string | null;
  private token: string | null = null;
  private sessionPromise: Promise<string> | null = null;

  constructor(base: string | null = resolveBase()) {
    this.base = base;
    this.token = getPlayerToken();
  }

  get configured(): boolean {
    return this.base !== null;
  }

  private async request<T>(method: string, path: string, body?: unknown, auth: 'required' | 'optional' | 'none' = 'required', timeoutMs = 8000): Promise<T> {
    if (this.base === null) throw new RankingError('not_configured', 'ランキングサーバーが設定されていません。');
    const doFetch = async (token: string | null) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(`${this.base}${path}`, {
          method,
          headers: {
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
          credentials: 'omit',
        });
      } catch (e) {
        throw new RankingError((e as Error).name === 'AbortError' ? 'timeout' : 'network', 'ランキングに接続できません。');
      } finally {
        clearTimeout(timer);
      }
    };
    let token = auth === 'none' ? null : auth === 'required' ? await this.ensureSession() : this.token;
    let res = await doFetch(token);
    if (res.status === 401 && auth === 'required') {
      // 無効なセッション → 作り直して1回だけ再試行
      this.token = null;
      savePlayerToken(null);
      token = await this.ensureSession();
      res = await doFetch(token);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const j = (json ?? {}) as { error?: string; message?: string };
      throw new RankingError(j.error ?? `http_${res.status}`, j.message ?? 'ランキングに接続できません。', res.status);
    }
    return json as T;
  }

  ensureSession(): Promise<string> {
    if (this.token) return Promise.resolve(this.token);
    if (!this.sessionPromise) {
      this.sessionPromise = this.request<{ token: string }>('POST', '/api/session', {}, 'none')
        .then((r) => {
          this.token = r.token;
          savePlayerToken(r.token);
          return r.token;
        })
        .finally(() => {
          this.sessionPromise = null;
        });
    }
    return this.sessionPromise;
  }

  createRun(recipe: Recipe, timeoutMs = 2500): Promise<RunTicket> {
    const { eggId, targetId, edgeId, oilId, oilAmountId } = recipe;
    return this.request<RunTicket>('POST', '/api/runs', { eggId, targetId, edgeId, oilId, oilAmountId }, 'required', timeoutMs);
  }

  finish(runId: string, events: CookEvent[], stopStep: number): Promise<VerifiedResult> {
    return this.request<VerifiedResult>('POST', `/api/runs/${encodeURIComponent(runId)}/finish`, { events, stopStep });
  }

  publish(resultId: string, displayName: string): Promise<PublishResponse> {
    return this.request<PublishResponse>('POST', `/api/results/${encodeURIComponent(resultId)}/publish`, { displayName });
  }

  leaderboard(eggId: EggId, targetId: TargetId, edgeId: EdgeId, period: Period, version: string): Promise<LeaderboardResponse> {
    const q = new URLSearchParams({ egg: eggId, target: targetId, edge: edgeId, period, version });
    return this.request<LeaderboardResponse>('GET', `/api/leaderboard?${q}`, undefined, 'optional');
  }
}

export const ranking = new RankingClient();
