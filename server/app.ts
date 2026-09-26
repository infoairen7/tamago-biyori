// ランキングAPI。クライアントの点数は受け取らず、操作ログをサーバー側の同じモデルで再計算します。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { GAME_CONFIG, STEPS_PER_SECOND, getEgg, getTarget, isEggId, isTargetId, type EggId, type TargetId } from '../shared/config.ts';
import { scoreCook } from '../shared/model.ts';
import { canonicalLog, replay, validateLog } from '../shared/events.ts';
import { normalizeDisplayName } from '../shared/name.ts';
import { jstWeekStart, WEEK_MS } from '../shared/period.ts';
import type { LeaderboardEntry, LeaderboardResponse, Period, PublishResponse, RankInfo, RunTicket, VerifiedResult } from '../shared/api-types.ts';
import { openDb, transaction, cleanup } from './db.ts';

export interface AppOptions {
  dbPath: string;
  /** CORSを許可するオリジン（例: https://example.github.io）。同一オリジン配信なら空で可 */
  allowedOrigins?: string[];
  /** ビルド済みフロントエンド（dist）を同じサーバーから配信する場合のディレクトリ */
  staticDir?: string;
  /** 運営用の非表示操作に使うトークン（未設定なら運営APIは無効） */
  adminToken?: string;
  runTtlMs?: number;
  /** 調理秒数とサーバー実経過の比較で許容する差（ミリ秒） */
  elapsedToleranceMs?: number;
  eventsRetentionDays?: number;
  /** リバースプロキシ配下でX-Forwarded-Forを信頼するか */
  trustProxy?: boolean;
  rateLimit?: boolean;
  now?: () => number;
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_BODY_BYTES = 64 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** 単純な固定窓のレート制限（1プロセス内） */
class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  check(key: string, limit: number, windowMs: number, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      if (this.hits.size > 50_000) this.prune(now);
      return true;
    }
    h.count++;
    return h.count <= limit;
  }
  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

const RATE_LIMITS: Record<string, [number, number]> = {
  session: [10, 60_000],
  runs: [30, 60_000],
  finish: [30, 60_000],
  publish: [10, 60_000],
  leaderboard: [120, 60_000],
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface RunRow {
  id: string;
  player_id: string;
  egg_id: string;
  target_id: string;
  seed: number;
  scoring_version: string;
  started_at: number;
  expires_at: number;
  status: 'issued' | 'finished';
  log_hash: string | null;
}

interface ResultRow {
  id: string;
  run_id: string;
  player_id: string;
  egg_id: string;
  target_id: string;
  scoring_version: string;
  w: number;
  y: number;
  b: number;
  d: number;
  score: number;
  stop_step: number;
  verified_at: number;
  week_start: number;
  published_at: number | null;
  display_name: string | null;
  hidden_at: number | null;
}

function toVerified(r: ResultRow): VerifiedResult {
  return {
    resultId: r.id,
    runId: r.run_id,
    eggId: r.egg_id as EggId,
    targetId: r.target_id as TargetId,
    scoringVersion: r.scoring_version,
    W: r.w,
    Y: r.y,
    B: r.b,
    D: r.d,
    score: r.score,
    stopStep: r.stop_step,
    verifiedAt: r.verified_at,
    weekStart: r.week_start,
    publishedAt: r.published_at,
    displayName: r.display_name,
  };
}

export function createApp(opts: AppOptions) {
  const db: DatabaseSync = openDb(opts.dbPath);
  const now = opts.now ?? (() => Date.now());
  const runTtlMs = opts.runTtlMs ?? 15 * 60 * 1000;
  const elapsedToleranceMs = opts.elapsedToleranceMs ?? 3000;
  const allowedOrigins = new Set((opts.allowedOrigins ?? []).map((o) => o.trim()).filter(Boolean));
  const limiter = new RateLimiter();
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;

  cleanup(db, now(), opts.eventsRetentionDays ?? 30);

  // ---- 共通処理 ----

  function clientIp(req: IncomingMessage): string {
    if (opts.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function rate(req: IncomingMessage, bucket: keyof typeof RATE_LIMITS) {
    if (opts.rateLimit === false) return;
    const [limit, windowMs] = RATE_LIMITS[bucket];
    if (!limiter.check(`${bucket}:${clientIp(req)}`, limit, windowMs, now())) {
      throw new HttpError(429, 'rate_limited', '操作が多すぎます。少し待ってからお試しください。');
    }
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'JSONで送信してください。');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', '送信データが大きすぎます。');
      chunks.push(chunk as Buffer);
    }
    if (size === 0) return {};
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'bad_json', 'JSONの形式が正しくありません。');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'JSONの形式が正しくありません。');
    return body as Record<string, unknown>;
  }

  function bearer(req: IncomingMessage): string | null {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return null;
    const t = h.slice(7).trim();
    return t.length >= 20 && t.length <= 200 ? t : null;
  }

  function playerIdFor(req: IncomingMessage, required: true): string;
  function playerIdFor(req: IncomingMessage, required: false): string | null;
  function playerIdFor(req: IncomingMessage, required: boolean): string | null {
    const token = bearer(req);
    if (!token) {
      if (required) throw new HttpError(401, 'unauthorized', 'セッションが必要です。');
      return null;
    }
    const row = db.prepare('SELECT id FROM players WHERE session_credential_hash = ?').get(sha256(token)) as { id: string } | undefined;
    if (!row) {
      if (required) throw new HttpError(401, 'unauthorized', 'セッションが無効です。');
      return null;
    }
    return row.id;
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(data),
    });
    res.end(data);
  }

  function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      return true;
    }
    return false;
  }

  // ---- ランキング計算 ----

  function rankedQuery(version: string, egg: string, target: string, weekStart: number | null) {
    // 参加者ごとの区分内自己ベスト1件 → 競技順位（1,1,3）。並びは先に達成した日時、最後にresultId。
    return db.prepare(`
      WITH best AS (
        SELECT id, player_id, display_name, score, verified_at,
               ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, verified_at ASC, id ASC) AS rn
        FROM results
        WHERE scoring_version = ? AND egg_id = ? AND target_id = ?
          AND published_at IS NOT NULL AND hidden_at IS NULL
          ${weekStart === null ? '' : 'AND week_start = ?'}
      )
      SELECT id, player_id, display_name, score, verified_at,
             RANK() OVER (ORDER BY score DESC) AS rank,
             COUNT(*) OVER () AS total
      FROM best WHERE rn = 1
      ORDER BY score DESC, verified_at ASC, id ASC
    `).all(...(weekStart === null ? [version, egg, target] : [version, egg, target, weekStart])) as {
      id: string;
      player_id: string;
      display_name: string;
      score: number;
      verified_at: number;
      rank: number;
      total: number;
    }[];
  }

  function rankOf(playerId: string, version: string, egg: string, target: string, weekStart: number | null): RankInfo | null {
    const rows = rankedQuery(version, egg, target, weekStart);
    const me = rows.find((r) => r.player_id === playerId);
    return me ? { rank: me.rank, score: me.score, total: me.total } : null;
  }

  // ---- ハンドラー ----

  async function createSession(req: IncomingMessage, res: ServerResponse) {
    rate(req, 'session');
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO players (id, created_at, session_credential_hash) VALUES (?, ?, ?)').run(randomUUID(), now(), sha256(token));
    send(res, 201, { token });
  }

  async function createRun(req: IncomingMessage, res: ServerResponse) {
    rate(req, 'runs');
    const playerId = playerIdFor(req, true);
    const body = await readJson(req);
    if (!isEggId(body.eggId) || !isTargetId(body.targetId)) throw new HttpError(400, 'bad_request', '卵または仕上がりの指定が正しくありません。');
    const t = now();
    const ticket: RunTicket = {
      runId: randomUUID(),
      seed: randomInt(0, 2 ** 32),
      scoringVersion: GAME_CONFIG.scoringVersion,
      eggId: body.eggId,
      targetId: body.targetId,
      startedAt: t,
      expiresAt: t + runTtlMs,
    };
    db.prepare(
      `INSERT INTO runs (id, player_id, egg_id, target_id, seed, scoring_version, started_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
    ).run(ticket.runId, playerId, ticket.eggId, ticket.targetId, ticket.seed, ticket.scoringVersion, ticket.startedAt, ticket.expiresAt);
    send(res, 201, ticket);
  }

  async function finishRun(req: IncomingMessage, res: ServerResponse, runId: string) {
    rate(req, 'finish');
    const playerId = playerIdFor(req, true);
    const body = await readJson(req);
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
    if (!run) throw new HttpError(404, 'run_not_found', '記録が見つかりません。');
    if (run.player_id !== playerId) throw new HttpError(403, 'forbidden', 'このプレイの記録は操作できません。');

    if ('score' in body || 'W' in body || 'result' in body) {
      // クライアントの点数は採用しない。紛らわしい送信は明示的に拒否する
      throw new HttpError(400, 'client_score_not_accepted', '点数はサーバーで計算します。操作ログだけを送信してください。');
    }
    const v = validateLog(body.events, body.stopStep);
    if (!v.ok) throw new HttpError(422, `invalid_log:${v.error}`, '操作ログを確認できませんでした。');
    const logHash = sha256(canonicalLog(v.events, v.stopStep));

    if (run.status === 'finished') {
      // 同じ内容の再送は同じ結果を返す。異なるログへの差し替えは拒否
      if (run.log_hash !== logHash) throw new HttpError(409, 'run_already_finished', 'このプレイは既に記録済みです。');
      const existing = db.prepare('SELECT * FROM results WHERE run_id = ?').get(run.id) as ResultRow | undefined;
      if (!existing) throw new HttpError(500, 'internal', '記録の読み込みに失敗しました。');
      send(res, 200, toVerified(existing));
      return;
    }

    const t = now();
    if (t > run.expires_at) throw new HttpError(410, 'run_expired', '記録の有効期限が切れました。この結果は端末内の記録として残ります。');
    if (run.scoring_version !== GAME_CONFIG.scoringVersion) {
      throw new HttpError(409, 'version_mismatch', '採点バージョンが更新されたため、この記録は登録できません。');
    }
    const cookMs = (v.stopStep / STEPS_PER_SECOND) * 1000;
    if (cookMs > t - run.started_at + elapsedToleranceMs) {
      throw new HttpError(422, 'invalid_log:elapsed', '調理時間が実際の経過時間と合いません。');
    }

    const egg = getEgg(run.egg_id as EggId);
    const target = getTarget(run.target_id as TargetId);
    const state = replay(v.events, v.stopStep, egg.gameSpeed);
    const breakdown = scoreCook(state, target.targetY);
    const row: ResultRow = {
      id: randomUUID(),
      run_id: run.id,
      player_id: playerId,
      egg_id: run.egg_id,
      target_id: run.target_id,
      scoring_version: run.scoring_version,
      w: state.W,
      y: state.Y,
      b: state.B,
      d: state.D,
      score: breakdown.score,
      stop_step: v.stopStep,
      verified_at: t,
      week_start: jstWeekStart(t),
      published_at: null,
      display_name: null,
      hidden_at: null,
    };

    transaction(db, () => {
      // 状態を条件にした更新で、同時送信による二重登録を防ぐ
      const upd = db.prepare("UPDATE runs SET status = 'finished', log_hash = ? WHERE id = ? AND status = 'issued'").run(logHash, run.id);
      if (Number(upd.changes) !== 1) throw new HttpError(409, 'run_already_finished', 'このプレイは既に記録済みです。');
      db.prepare(
        `INSERT INTO results (id, run_id, player_id, egg_id, target_id, scoring_version, w, y, b, d, score, stop_step, verified_at, week_start)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.run_id, row.player_id, row.egg_id, row.target_id, row.scoring_version, row.w, row.y, row.b, row.d, row.score, row.stop_step, row.verified_at, row.week_start);
      const ins = db.prepare('INSERT INTO events (run_id, seq, step, action, value, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const e of v.events) ins.run(run.id, e.seq, e.step, e.action, e.value, t);
    });
    send(res, 201, toVerified(row));
  }

  async function publishResult(req: IncomingMessage, res: ServerResponse, resultId: string) {
    rate(req, 'publish');
    const playerId = playerIdFor(req, true);
    const body = await readJson(req);
    const r = db.prepare('SELECT * FROM results WHERE id = ?').get(resultId) as ResultRow | undefined;
    if (!r) throw new HttpError(404, 'result_not_found', '記録が見つかりません。');
    if (r.player_id !== playerId) throw new HttpError(403, 'forbidden', 'この記録は操作できません。');
    if (r.published_at !== null) throw new HttpError(409, 'already_published', 'この記録は登録済みです。');
    const name = normalizeDisplayName(body.displayName);
    if (!name.ok) {
      const msg = name.error === 'too_long' ? '名前は12文字以内で入力してください。' : '名前を入力してください。';
      throw new HttpError(400, `bad_name:${name.error}`, msg);
    }
    const t = now();
    transaction(db, () => {
      const upd = db.prepare('UPDATE results SET published_at = ?, display_name = ? WHERE id = ? AND published_at IS NULL').run(t, name.name, r.id);
      if (Number(upd.changes) !== 1) throw new HttpError(409, 'already_published', 'この記録は登録済みです。');
      db.prepare('UPDATE players SET display_name = ? WHERE id = ?').run(name.name, playerId);
    });
    const updated = db.prepare('SELECT * FROM results WHERE id = ?').get(r.id) as unknown as ResultRow;
    const body2: PublishResponse = {
      result: toVerified(updated),
      weekly: rankOf(playerId, r.scoring_version, r.egg_id, r.target_id, jstWeekStart(t)),
      allTime: rankOf(playerId, r.scoring_version, r.egg_id, r.target_id, null),
      fetchedAt: t,
    };
    send(res, 200, body2);
  }

  async function leaderboard(req: IncomingMessage, res: ServerResponse, url: URL) {
    rate(req, 'leaderboard');
    const egg = url.searchParams.get('egg');
    const target = url.searchParams.get('target');
    const period = (url.searchParams.get('period') ?? 'weekly') as Period;
    const version = url.searchParams.get('version') ?? GAME_CONFIG.scoringVersion;
    if (!isEggId(egg) || !isTargetId(target) || (period !== 'weekly' && period !== 'all') || version.length > 20) {
      throw new HttpError(400, 'bad_request', '条件の指定が正しくありません。');
    }
    const playerId = playerIdFor(req, false);
    const t = now();
    const weekStart = period === 'weekly' ? jstWeekStart(t) : null;
    const rows = rankedQuery(version, egg, target, weekStart);
    const entries: LeaderboardEntry[] = rows.slice(0, 50).map((r) => ({
      rank: r.rank,
      displayName: r.display_name,
      score: r.score,
      verifiedAt: r.verified_at,
      isMe: playerId !== null && r.player_id === playerId,
    }));
    const me = playerId ? rows.find((r) => r.player_id === playerId) : undefined;
    const body: LeaderboardResponse = {
      scoringVersion: version,
      eggId: egg,
      targetId: target,
      period,
      range: weekStart === null ? null : { start: weekStart, end: weekStart + WEEK_MS },
      entries,
      me: me ? { rank: me.rank, score: me.score, total: me.total } : null,
      total: rows.length,
      fetchedAt: t,
    };
    send(res, 200, body);
  }

  function adminHide(req: IncomingMessage, res: ServerResponse, resultId: string, hide: boolean) {
    if (!opts.adminToken) throw new HttpError(404, 'not_found', '見つかりません。');
    const token = bearer(req);
    if (!token || sha256(token) !== sha256(opts.adminToken)) throw new HttpError(401, 'unauthorized', '権限がありません。');
    const upd = db.prepare('UPDATE results SET hidden_at = ? WHERE id = ?').run(hide ? now() : null, resultId);
    if (Number(upd.changes) !== 1) throw new HttpError(404, 'result_not_found', '記録が見つかりません。');
    send(res, 200, { ok: true, resultId, hidden: hide });
  }

  // ---- 静的ファイル（任意） ----

  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    if (pathname.includes('\0')) return false;
    let file = resolve(join(staticRoot, pathname));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return false;
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch {
      if (extname(pathname)) return false;
      file = join(staticRoot, 'index.html');
    }
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      return false;
    }
    const ext = extname(file);
    const immutable = /[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  }

  // ---- ルーティング ----

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        const corsOk = applyCors(req, res);
        if (req.method === 'OPTIONS') {
          res.writeHead(corsOk ? 204 : 403);
          res.end();
          return;
        }
        let m: RegExpMatchArray | null;
        if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, scoringVersion: GAME_CONFIG.scoringVersion });
        if (req.method === 'POST' && path === '/api/session') return await createSession(req, res);
        if (req.method === 'POST' && path === '/api/runs') return await createRun(req, res);
        if (req.method === 'POST' && (m = path.match(/^\/api\/runs\/([0-9a-f-]{36})\/finish$/))) return await finishRun(req, res, m[1]);
        if (req.method === 'POST' && (m = path.match(/^\/api\/results\/([0-9a-f-]{36})\/publish$/))) return await publishResult(req, res, m[1]);
        if (req.method === 'GET' && path === '/api/leaderboard') return await leaderboard(req, res, url);
        if (req.method === 'POST' && (m = path.match(/^\/api\/admin\/results\/([0-9a-f-]{36})\/(hide|unhide)$/))) return adminHide(req, res, m[1], m[2] === 'hide');
        throw new HttpError(404, 'not_found', '見つかりません。');
      }
      if (await serveStatic(req, res, url)) return;
      throw new HttpError(404, 'not_found', '見つかりません。');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      console.error('[server] unexpected error', e);
      return send(res, 500, { error: 'internal', message: 'サーバーでエラーが発生しました。' });
    }
  }

  const cleanupTimer = setInterval(() => cleanup(db, now(), opts.eventsRetentionDays ?? 30), 6 * 60 * 60 * 1000);
  cleanupTimer.unref();

  return {
    handle,
    db,
    close() {
      clearInterval(cleanupTimer);
      db.close();
    },
  };
}
