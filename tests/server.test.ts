import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { replay } from '../shared/events.ts';
import { scoreCook } from '../shared/model.ts';
import type { CookEvent } from '../shared/events.ts';

let clock = Date.UTC(2026, 8, 24, 3, 0); // 2026-09-24(木) 12:00 JST
let server: Server;
let base = '';
let app: ReturnType<typeof createApp>;
const staticDir = mkdtempSync(join(tmpdir(), 'tamago-static-'));

before(async () => {
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>ok</title>');
  writeFileSync(join(staticDir, 'assets', 'app-abcdef12.js'), 'console.log(1)');
  app = createApp({
    dbPath: ':memory:',
    now: () => clock,
    rateLimit: false,
    allowedOrigins: ['https://game.example'],
    adminToken: 'admin-secret-token-for-tests-0000',
    staticDir,
  });
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
  app.close();
});

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function newPlayer(): Promise<string> {
  const r = await call('POST', '/api/session', {});
  assert.equal(r.status, 201);
  return r.json.token;
}

const goodLog: CookEvent[] = [
  { seq: 0, step: 300, action: 'lid', value: 'closed' },
  { seq: 1, step: 900, action: 'lid', value: 'open' },
];
const goodStop = 1500; // 25秒

async function playRun(token: string, egg = 'white', target = 'soft', events: CookEvent[] = goodLog, stopStep = goodStop) {
  const run = await call('POST', '/api/runs', { eggId: egg, targetId: target }, token);
  assert.equal(run.status, 201);
  clock += stopStep * (1000 / 60) + 3000;
  const fin = await call('POST', `/api/runs/${run.json.runId}/finish`, { events, stopStep }, token);
  return { run: run.json, fin };
}

test('health', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.scoringVersion, '1.0.0');
});

test('セッションなしのrun発行は401', async () => {
  const r = await call('POST', '/api/runs', { eggId: 'white', targetId: 'soft' });
  assert.equal(r.status, 401);
  const bad = await call('POST', '/api/runs', { eggId: 'white', targetId: 'soft' }, 'x'.repeat(40));
  assert.equal(bad.status, 401);
});

test('正しいプレイはサーバーで再計算され、公開登録・ランキング取得できる', async () => {
  const token = await newPlayer();
  const { run, fin } = await playRun(token);
  assert.equal(fin.status, 201);
  const expected = scoreCook(replay(goodLog, goodStop, 1), 0.38).score;
  assert.equal(fin.json.score, expected);
  assert.equal(typeof run.seed, 'number');
  const pub = await call('POST', `/api/results/${fin.json.resultId}/publish`, { displayName: 'あさごはん部' }, token);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.weekly.rank, 1);
  const lb = await call('GET', '/api/leaderboard?egg=white&target=soft&period=weekly', undefined, token);
  assert.equal(lb.status, 200);
  assert.equal(lb.json.entries.length, 1);
  assert.equal(lb.json.entries[0].displayName, 'あさごはん部');
  assert.equal(lb.json.entries[0].isMe, true);
  assert.equal(lb.json.me.rank, 1);
  // 別区分には出ない
  const other = await call('GET', '/api/leaderboard?egg=white&target=firm&period=weekly');
  assert.equal(other.json.entries.length, 0);
});

test('任意のスコア送信は拒否される', async () => {
  const token = await newPlayer();
  const run = await call('POST', '/api/runs', { eggId: 'brown', targetId: 'soft' }, token);
  clock += 60_000;
  const r = await call('POST', `/api/runs/${run.json.runId}/finish`, { events: [], stopStep: 100, score: 100 }, token);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'client_score_not_accepted');
  // 結果を直接作るAPIは存在しない
  const direct = await call('POST', '/api/results', { score: 100, eggId: 'brown', targetId: 'soft' }, token);
  assert.equal(direct.status, 404);
  const lb = await call('GET', '/api/leaderboard?egg=brown&target=soft&period=all');
  assert.equal(lb.json.entries.length, 0);
});

test('runの再利用：同じログの再送は同じ結果、異なるログは拒否', async () => {
  const token = await newPlayer();
  const { run, fin } = await playRun(token, 'quail', 'medium');
  assert.equal(fin.status, 201);
  const again = await call('POST', `/api/runs/${run.runId}/finish`, { events: goodLog, stopStep: goodStop }, token);
  assert.equal(again.status, 200);
  assert.equal(again.json.resultId, fin.json.resultId);
  assert.equal(again.json.score, fin.json.score);
  const swapped = await call('POST', `/api/runs/${run.runId}/finish`, { events: [], stopStep: 2400 }, token);
  assert.equal(swapped.status, 409);
});

test('同時の二重送信でも結果は1件', async () => {
  const token = await newPlayer();
  const run = await call('POST', '/api/runs', { eggId: 'white', targetId: 'medium' }, token);
  clock += 120_000;
  const body = { events: goodLog, stopStep: goodStop };
  const [a, b] = await Promise.all([
    call('POST', `/api/runs/${run.json.runId}/finish`, body, token),
    call('POST', `/api/runs/${run.json.runId}/finish`, body, token),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.json.resultId, b.json.resultId);
  const count = app.db.prepare('SELECT COUNT(*) AS n FROM results WHERE run_id = ?').get(run.json.runId) as { n: number };
  assert.equal(count.n, 1);
});

test('異常なstep・不自然な調理時間は拒否', async () => {
  const token = await newPlayer();
  const run = await call('POST', '/api/runs', { eggId: 'white', targetId: 'soft' }, token);
  clock += 100_000;
  const id = run.json.runId;
  const r1 = await call('POST', `/api/runs/${id}/finish`, { events: [{ seq: 0, step: 99999, action: 'heat', value: 'low' }], stopStep: 100 }, token);
  assert.equal(r1.status, 422);
  assert.equal(r1.json.error, 'invalid_log:bad_step');
  const r2 = await call(
    'POST',
    `/api/runs/${id}/finish`,
    {
      events: [
        { seq: 0, step: 50, action: 'heat', value: 'low' },
        { seq: 1, step: 10, action: 'heat', value: 'high' },
      ],
      stopStep: 100,
    },
    token,
  );
  assert.equal(r2.json.error, 'invalid_log:step_decreasing');
  const r3 = await call('POST', `/api/runs/${id}/finish`, { events: [], stopStep: 5401 }, token);
  assert.equal(r3.json.error, 'invalid_log:bad_stop_step');
  const r4 = await call('POST', `/api/runs/${id}/finish`, { events: [{ seq: 0, step: 1, action: 'teleport', value: 'x' }], stopStep: 10 }, token);
  assert.equal(r4.json.error, 'invalid_log:bad_action');

  // 発行直後に90秒分の調理ログ → 実経過より長いので拒否
  const run2 = await call('POST', '/api/runs', { eggId: 'white', targetId: 'soft' }, token);
  clock += 10_000;
  const r5 = await call('POST', `/api/runs/${run2.json.runId}/finish`, { events: [], stopStep: 5400 }, token);
  assert.equal(r5.status, 422);
  assert.equal(r5.json.error, 'invalid_log:elapsed');
});

test('別プレイヤーのrunは終了・公開できない', async () => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const run = await call('POST', '/api/runs', { eggId: 'white', targetId: 'firm' }, alice);
  clock += 60_000;
  const steal = await call('POST', `/api/runs/${run.json.runId}/finish`, { events: [], stopStep: 1200 }, bob);
  assert.equal(steal.status, 403);
  const fin = await call('POST', `/api/runs/${run.json.runId}/finish`, { events: [], stopStep: 1200 }, alice);
  assert.equal(fin.status, 201);
  const pubByBob = await call('POST', `/api/results/${fin.json.resultId}/publish`, { displayName: 'ぼぶ' }, bob);
  assert.equal(pubByBob.status, 403);
});

test('期限切れのrunは拒否（410）', async () => {
  const token = await newPlayer();
  const run = await call('POST', '/api/runs', { eggId: 'brown', targetId: 'firm' }, token);
  clock += 16 * 60 * 1000;
  const r = await call('POST', `/api/runs/${run.json.runId}/finish`, { events: [], stopStep: 1000 }, token);
  assert.equal(r.status, 410);
});

test('公開登録は一度だけ・名前は1〜12書記素', async () => {
  const token = await newPlayer();
  const { fin } = await playRun(token, 'brown', 'medium');
  const id = fin.json.resultId;
  assert.equal((await call('POST', `/api/results/${id}/publish`, { displayName: '   ' }, token)).status, 400);
  assert.equal((await call('POST', `/api/results/${id}/publish`, { displayName: 'あいうえおかきくけこさしす' }, token)).status, 400);
  assert.equal((await call('POST', `/api/results/${id}/publish`, { displayName: 123 }, token)).status, 400);
  const ok = await call('POST', `/api/results/${id}/publish`, { displayName: '👩‍🍳<b>たま‮ご</b>' }, token);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result.displayName, '👩‍🍳<b>たまご</b>'); // 制御文字は除去、HTMLは文字列のまま（表示側でエスケープ）
  const twice = await call('POST', `/api/results/${id}/publish`, { displayName: 'もう一回' }, token);
  assert.equal(twice.status, 409);
});

test('同点は同順位（1,1,3）、参加者ごとの自己ベスト1件', async () => {
  const eggTarget = { egg: 'quail', target: 'firm' };
  const make = async (name: string, stopStep: number) => {
    const t = await newPlayer();
    const { fin } = await playRun(t, eggTarget.egg, eggTarget.target, [], stopStep);
    await call('POST', `/api/results/${fin.json.resultId}/publish`, { displayName: name }, t);
    return { t, score: fin.json.score };
  };
  const a = await make('A', 2400);
  const b = await make('B', 2400);
  const c = await make('C', 1800);
  assert.equal(a.score, b.score);
  assert.ok(c.score < a.score);
  // Cが2回目でより高い点を出す → 自己ベストのみ反映
  const { fin } = await playRun(c.t, eggTarget.egg, eggTarget.target, [], 2400);
  await call('POST', `/api/results/${fin.json.resultId}/publish`, { displayName: 'C' }, c.t);
  const lb = await call('GET', '/api/leaderboard?egg=quail&target=firm&period=weekly', undefined, c.t);
  assert.deepEqual(
    lb.json.entries.map((e: any) => [e.rank, e.displayName]),
    [
      [1, 'A'],
      [1, 'B'],
      [1, 'C'],
    ],
  );
  assert.equal(lb.json.total, 3);
  // 1,1,3 の確認
  const d = await make('D', 1500);
  const lb2 = await call('GET', '/api/leaderboard?egg=quail&target=firm&period=weekly');
  assert.ok(d.score < a.score);
  assert.deepEqual(lb2.json.entries.map((e: any) => e.rank), [1, 1, 1, 4]);
});

test('週の切り替え（日本時間 月曜00:00）で週間は新区分、全期間には残る', async () => {
  clock = Date.UTC(2026, 9, 4, 14, 50); // 2026-10-04(日) 23:50 JST
  const t = await newPlayer();
  const run = await call('POST', '/api/runs', { eggId: 'white', targetId: 'firm' }, t);
  clock += 30_000; // まだ日曜
  const fin = await call('POST', `/api/runs/${run.json.runId}/finish`, { events: [{ seq: 0, step: 0, action: 'lid', value: 'closed' }], stopStep: 1500 }, t);
  assert.equal(fin.status, 201);
  await call('POST', `/api/results/${fin.json.resultId}/publish`, { displayName: 'にちようび' }, t);
  const weekBefore = await call('GET', '/api/leaderboard?egg=white&target=firm&period=weekly');
  assert.ok(weekBefore.json.entries.some((e: any) => e.displayName === 'にちようび'));
  clock = Date.UTC(2026, 9, 4, 15, 0); // 月曜00:00 JST
  const weekAfter = await call('GET', '/api/leaderboard?egg=white&target=firm&period=weekly');
  assert.equal(weekAfter.json.entries.length, 0);
  assert.equal(weekAfter.json.range.start, Date.UTC(2026, 9, 4, 15, 0));
  const all = await call('GET', '/api/leaderboard?egg=white&target=firm&period=all');
  assert.ok(all.json.entries.some((e: any) => e.displayName === 'にちようび'));
});

test('運営は不適切な名前の記録を非表示にできる', async () => {
  const t = await newPlayer();
  const { fin } = await playRun(t, 'brown', 'soft');
  await call('POST', `/api/results/${fin.json.resultId}/publish`, { displayName: 'ふてきせつ' }, t);
  const before = await call('GET', '/api/leaderboard?egg=brown&target=soft&period=weekly');
  assert.ok(before.json.entries.some((e: any) => e.displayName === 'ふてきせつ'));
  assert.equal((await call('POST', `/api/admin/results/${fin.json.resultId}/hide`, {}, t)).status, 401);
  const hide = await call('POST', `/api/admin/results/${fin.json.resultId}/hide`, {}, 'admin-secret-token-for-tests-0000');
  assert.equal(hide.status, 200);
  const afterHide = await call('GET', '/api/leaderboard?egg=brown&target=soft&period=weekly');
  assert.ok(!afterHide.json.entries.some((e: any) => e.displayName === 'ふてきせつ'));
});

test('CORSは許可したオリジンのみ', async () => {
  const ok = await call('OPTIONS', '/api/runs', undefined, undefined, { Origin: 'https://game.example' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://game.example');
  const ng = await call('OPTIONS', '/api/runs', undefined, undefined, { Origin: 'https://evil.example' });
  assert.equal(ng.status, 403);
  assert.equal(ng.headers.get('access-control-allow-origin'), null);
});

test('大きすぎる送信・JSON以外は拒否', async () => {
  const token = await newPlayer();
  const big = await call('POST', '/api/runs', 'x'.repeat(70_000), token);
  assert.equal(big.status, 413);
  const res = await fetch(base + '/api/runs', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('静的配信：index.htmlとassets、パストラバーサルは不可', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /<title>ok/);
  const js = await fetch(base + '/assets/app-abcdef12.js');
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const trav = await fetch(base + '/..%2f..%2fetc%2fpasswd');
  assert.notEqual(trav.status, 200);
  const missing = await fetch(base + '/nope.js');
  assert.equal(missing.status, 404);
});
