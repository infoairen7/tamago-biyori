import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_CONFIG, MAX_STEPS, getEgg, getTarget, type HeatLevel } from '../shared/config.ts';
import { displayBasePoints, displayBurnPenalty, initialCookState, scoreCook, stepCook } from '../shared/model.ts';
import { dedupeEvents, replay, validateLog, type CookEvent } from '../shared/events.ts';
import { jstWeekStart, formatJstRange, WEEK_MS } from '../shared/period.ts';
import { scan } from '../scripts/simulate.ts';
import { PlaySession } from '../src/game/session.ts';
import { mulberry32 } from '../shared/rng.ts';

test('未加熱の初期状態は0点', () => {
  const s = initialCookState();
  assert.equal(scoreCook(s, 0.38).score, 0);
});

test('卵3種×目標3種の全9条件で90点以上を取れる操作がある', () => {
  for (const egg of GAME_CONFIG.eggs) {
    for (const target of GAME_CONFIG.targets) {
      const best = Math.max(
        scan(egg, target, { label: '', heat: 'medium', lidClosed: false }).best,
        scan(egg, target, { label: '', heat: 'medium', lidClosed: true }).best,
        scan(egg, target, { label: '', heat: 'low', lidClosed: true }).best,
      );
      assert.ok(best >= 90, `${egg.id}×${target.id}: best=${best}`);
    }
  }
});

test('ふたなし中火でも全条件に90点以上の時間帯がある', () => {
  for (const egg of GAME_CONFIG.eggs) {
    for (const target of GAME_CONFIG.targets) {
      const w = scan(egg, target, { label: '', heat: 'medium', lidClosed: false });
      assert.ok(w.from !== null && w.to !== null && w.to - w.from >= 60, `${egg.id}×${target.id}`);
    }
  }
});

test('仕様書の確認表（中火）と一致する', () => {
  const at = (eggId: 'white' | 'quail', targetId: 'soft' | 'medium' | 'firm', lid: boolean) =>
    scan(getEgg(eggId), getTarget(targetId), { label: '', heat: 'medium', lidClosed: lid });
  const white = at('white', 'soft', false);
  assert.equal(white.best, 100);
  assert.ok(Math.abs(white.bestAt / 60 - 27.6) < 0.1);
  assert.ok(Math.abs(at('white', 'medium', false).bestAt / 60 - 46.9) < 0.1);
  assert.ok(Math.abs(at('white', 'firm', true).bestAt / 60 - 39.8) < 0.1);
  assert.ok(Math.abs(at('quail', 'soft', false).bestAt / 60 - 22.4) < 0.1);
});

test('強火で放置すると明確に焦げ、上限49点以下になる', () => {
  const s = initialCookState();
  s.heat = 'high';
  let capped = false;
  while (s.step < MAX_STEPS) {
    stepCook(s, 1);
    const b = scoreCook(s, 0.38);
    if (s.D >= 0.5) {
      assert.ok(b.score <= 49);
      capped = true;
    }
  }
  assert.ok(capped);
  assert.equal(s.D, 1);
  assert.ok(scoreCook(s, 0.38).score < 10);
});

test('生の白身（W<0.75）には39点の上限', () => {
  const b = scoreCook({ W: 0.74, Y: 0.38, B: 0.22, D: 0 }, 0.38);
  assert.ok(b.base > 39);
  assert.equal(b.score, 39);
  assert.equal(b.cap?.kind, 'rawWhite');
});

test('焦げD>=0.5には49点の上限', () => {
  const b = scoreCook({ W: 1, Y: 0.38, B: 0.22, D: 0.5 }, 0.38);
  assert.ok(b.score <= 49);
});

test('満点の状態は100点', () => {
  assert.equal(scoreCook({ W: 0.95, Y: 0.4, B: 0.25, D: 0 }, 0.38).score, 100);
});

test('ランダムな操作ログでも点数は0〜100の整数、W/Y/B/Dは0〜1', () => {
  const rnd = mulberry32(12345);
  const heats: HeatLevel[] = ['off', 'low', 'medium', 'high'];
  for (let n = 0; n < 300; n++) {
    const events: CookEvent[] = [];
    let step = 0;
    const count = Math.floor(rnd() * 30);
    for (let i = 0; i < count; i++) {
      step = Math.min(MAX_STEPS, step + Math.floor(rnd() * 400));
      if (rnd() < 0.6) events.push({ seq: events.length, step, action: 'heat', value: heats[Math.floor(rnd() * 4)] });
      else events.push({ seq: events.length, step, action: 'lid', value: rnd() < 0.5 ? 'open' : 'closed' });
    }
    const stopStep = Math.min(MAX_STEPS, step + Math.floor(rnd() * 2000));
    const egg = GAME_CONFIG.eggs[n % 3];
    const s = replay(events, stopStep, egg.gameSpeed);
    for (const v of [s.T, s.W, s.Y, s.B, s.D]) assert.ok(v >= 0 && v <= 1);
    for (const t of GAME_CONFIG.targets) {
      const sc = scoreCook(s, t.targetY).score;
      assert.ok(Number.isInteger(sc) && sc >= 0 && sc <= 100);
    }
  }
});

test('基礎点の表示配分は round(base) と一致し、焦げ減点・上限と最終点が整合する', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 2000; i++) {
    const f = { W: rnd(), Y: rnd(), B: rnd(), D: rnd() < 0.5 ? 0 : rnd() };
    const b = scoreCook(f, 0.62);
    const d = displayBasePoints(b);
    assert.equal(d.white + d.yolk + d.brown, d.total);
    assert.ok(d.white <= 40 && d.yolk <= 40 && d.brown <= 20);
    const afterPenalty = d.total - displayBurnPenalty(b);
    const expected = b.cap ? Math.min(afterPenalty, b.cap.value) : afterPenalty;
    assert.equal(expected, b.score);
  }
});

// ---- 操作ログと描画FPS ----

/** 指定fpsでフレームを進め、stepがイベント位置に達したフレームで操作するプレイヤー */
function playAtFps(fps: number, script: { step: number; act: (s: PlaySession) => void }[], stopAt: number, eggId: 'white' | 'quail' = 'white') {
  let now = 0;
  const s = new PlaySession(eggId, 'soft', 42, now);
  s.tapEgg((now += 500));
  s.tapEgg((now += 500));
  while (s.phase === 'drop') s.tick((now += 1000 / fps), 1 / fps);
  let k = 0;
  while (s.final === null) {
    while (k < script.length && s.cook.step >= script[k].step) script[k++].act(s);
    if (s.cook.step >= stopAt) {
      s.plate(now);
      break;
    }
    s.tick((now += 1000 / fps), 1 / fps);
  }
  return s;
}

test('同じ操作ログは30/60/120fpsの描画でも同じ点数・同じログになる', () => {
  const script = [
    { step: 600, act: (s: PlaySession) => s.setHeat('high') },
    { step: 900, act: (s: PlaySession) => s.setLid(true) },
    { step: 1200, act: (s: PlaySession) => s.setHeat('low') },
    { step: 1500, act: (s: PlaySession) => s.setLid(false) },
    { step: 1800, act: (s: PlaySession) => s.setHeat('off') },
  ];
  const results = [30, 60, 120].map((fps) => playAtFps(fps, script, 2400));
  const logs = results.map((r) => JSON.stringify(r.final!.events));
  assert.equal(logs[0], logs[1]);
  assert.equal(logs[1], logs[2]);
  const scores = results.map((r) => r.final!.breakdown.score);
  assert.deepEqual(scores, [scores[0], scores[0], scores[0]]);
  const stops = results.map((r) => r.final!.stopStep);
  assert.deepEqual(stops, [2400, 2400, 2400]);
  // サーバーと同じ再生関数でも一致
  const r = results[0].final!;
  const rep = replay(r.events, r.stopStep, 1);
  assert.equal(scoreCook(rep, 0.38).score, r.breakdown.score);
  assert.deepEqual([rep.W, rep.Y, rep.B, rep.D], [r.cook.W, r.cook.Y, r.cook.B, r.cook.D]);
});

test('不規則なフレーム間隔でも記録したログの再生結果は実プレイと完全一致する', () => {
  const rnd = mulberry32(99);
  for (let trial = 0; trial < 20; trial++) {
    let now = 0;
    const s = new PlaySession(trial % 2 ? 'quail' : 'brown', 'medium', trial, now);
    s.tapEgg((now += 300));
    s.tapEgg((now += 300));
    while (s.phase === 'drop') s.tick((now += 16), 0.016);
    while (s.final === null && s.cook.step < 4000) {
      const dt = 0.004 + rnd() * 0.06;
      s.tick((now += dt * 1000), dt);
      const r = rnd();
      if (r < 0.01) s.setHeat((['off', 'low', 'medium', 'high'] as const)[Math.floor(rnd() * 4)]);
      else if (r < 0.015) s.setLid(rnd() < 0.5);
    }
    if (!s.final) s.plate(now);
    const f = s.final!;
    const rep = replay(f.events, f.stopStep, s.egg.gameSpeed);
    assert.deepEqual([rep.W, rep.Y, rep.B, rep.D, rep.T], [f.cook.W, f.cook.Y, f.cook.B, f.cook.D, f.cook.T]);
    const v = validateLog(JSON.parse(JSON.stringify(f.events)), f.stopStep);
    assert.ok(v.ok);
  }
});

test('90秒で自動的に取り出し、stopStepは5400', () => {
  let now = 0;
  const s = new PlaySession('white', 'firm', 1, now);
  s.tapEgg((now += 200));
  s.tapEgg((now += 200));
  s.tick((now += 900), 0.9);
  assert.equal(s.phase, 'cooking');
  let stopped = null;
  for (let i = 0; i < 10000 && !s.final; i++) stopped = s.tick((now += 50), 0.05).stopped ?? stopped;
  assert.equal(stopped, 'timeout');
  assert.equal(s.final!.stopStep, MAX_STEPS);
  assert.equal(s.final!.reason, 'timeout');
});

test('お皿にうつした後は操作・時間経過で値が変わらない', () => {
  let now = 0;
  const s = new PlaySession('white', 'soft', 1, now);
  s.tapEgg((now += 200));
  s.tapEgg((now += 200));
  s.tick((now += 900), 0.9);
  for (let i = 0; i < 600; i++) s.tick((now += 16.7), 1 / 60);
  assert.ok(s.plate(now));
  const snapshot = JSON.stringify(s.final);
  const cookSnap = JSON.stringify(s.cook);
  assert.equal(s.setHeat('high'), false);
  assert.equal(s.setLid(true), false);
  assert.equal(s.plate(now), false);
  for (let i = 0; i < 200; i++) s.tick((now += 16.7), 1 / 60);
  s.pause();
  s.resume();
  assert.equal(JSON.stringify(s.final), snapshot);
  assert.equal(JSON.stringify(s.cook), cookSnap);
  assert.equal(s.phase, 'done');
});

test('一時停止中は熱も時間も進まず、再開時に隠れていた時間を加算しない', () => {
  let now = 0;
  const s = new PlaySession('white', 'soft', 1, now);
  s.tapEgg((now += 200));
  s.tapEgg((now += 200));
  s.tick((now += 900), 0.9);
  for (let i = 0; i < 60; i++) s.tick((now += 16.7), 1 / 60);
  const before = s.cook.step;
  s.pause();
  assert.equal(s.setHeat('high'), false);
  for (let i = 0; i < 100; i++) s.tick((now += 1000), 1);
  assert.equal(s.cook.step, before);
  s.resume();
  // 復帰直後に長い差分が来ても、1フレーム分（上限0.25秒=15step）以上は進めない
  const r = s.tick((now += 60000), 60);
  assert.ok(r.steps <= 15);
});

test('卵のタップ：2回で割れ、落下中の追加入力と二重発火は無視', () => {
  const s = new PlaySession('white', 'soft', 1, 0);
  assert.equal(s.tapEgg(1000), true);
  assert.equal(s.phase, 'cracked');
  assert.equal(s.tapEgg(1050), false); // 同じタップの二重発火
  assert.equal(s.tapEgg(1300), true);
  assert.equal(s.phase, 'drop');
  assert.equal(s.tapEgg(1500), false);
  assert.equal(s.tapEgg(1700), false);
  s.tick(2200, 0.5);
  assert.equal(s.phase, 'cooking');
  assert.equal(s.cook.T, GAME_CONFIG.initialHeat);
  assert.equal(s.cook.heat, 'medium');
  assert.equal(s.cook.lidClosed, false);
});

// ---- ログ検証 ----

test('ログ検証：不正な形式を拒否し、同じ値の連続を除去する', () => {
  const ok = (events: unknown, stop: unknown) => validateLog(events, stop);
  assert.equal(ok('x', 10).ok, false);
  assert.deepEqual(ok([{ seq: 1, step: 0, action: 'heat', value: 'low' }], 10), { ok: false, error: 'bad_seq' });
  assert.deepEqual(ok([{ seq: 0, step: -1, action: 'heat', value: 'low' }], 10), { ok: false, error: 'bad_step' });
  assert.deepEqual(ok([{ seq: 0, step: 1.5, action: 'heat', value: 'low' }], 10), { ok: false, error: 'bad_step' });
  assert.deepEqual(ok([{ seq: 0, step: 5401, action: 'heat', value: 'low' }], 5400), { ok: false, error: 'bad_step' });
  assert.deepEqual(
    ok(
      [
        { seq: 0, step: 10, action: 'heat', value: 'low' },
        { seq: 1, step: 5, action: 'heat', value: 'high' },
      ],
      20,
    ),
    { ok: false, error: 'step_decreasing' },
  );
  assert.deepEqual(ok([{ seq: 0, step: 1, action: 'score', value: 100 }], 10), { ok: false, error: 'bad_action' });
  assert.deepEqual(ok([{ seq: 0, step: 1, action: 'heat', value: 'nuclear' }], 10), { ok: false, error: 'bad_value' });
  assert.deepEqual(ok([{ seq: 0, step: 1, action: 'heat', value: 'low', score: 100 }], 10), { ok: false, error: 'bad_event' });
  assert.deepEqual(ok([], 5401), { ok: false, error: 'bad_stop_step' });
  assert.deepEqual(ok([{ seq: 0, step: 50, action: 'lid', value: 'closed' }], 40), { ok: false, error: 'stop_before_last_event' });

  const dup = validateLog(
    [
      { seq: 0, step: 1, action: 'heat', value: 'medium' }, // 初期値と同じ → 除去
      { seq: 1, step: 2, action: 'heat', value: 'low' },
      { seq: 2, step: 3, action: 'heat', value: 'low' }, // 連続 → 除去
      { seq: 3, step: 4, action: 'lid', value: 'closed' },
    ],
    10,
  );
  assert.ok(dup.ok);
  if (dup.ok) assert.deepEqual(dup.events.map((e) => [e.seq, e.step, e.value]), [[0, 2, 'low'], [1, 4, 'closed']]);
});

test('ログ検証：重複除去後に500件を超えると拒否（理由を明示）', () => {
  const events = [];
  for (let i = 0; i < 502; i++) events.push({ seq: i, step: i, action: 'lid', value: i % 2 === 0 ? 'closed' : 'open' });
  assert.deepEqual(validateLog(events, 600), { ok: false, error: 'too_many_events' });
  const many = [];
  for (let i = 0; i < 2001; i++) many.push({ seq: i, step: 0, action: 'lid', value: 'open' });
  assert.deepEqual(validateLog(many, 600), { ok: false, error: 'too_many_raw_events' });
  assert.equal(dedupeEvents(many as CookEvent[]).length, 0);
});

// ---- 週区切り ----

test('週区切りは日本時間の月曜00:00', () => {
  const now = Date.UTC(2026, 8, 26, 18, 45); // 2026-09-27(日) 03:45 JST
  const start = jstWeekStart(now);
  assert.equal(start, Date.UTC(2026, 8, 20, 15, 0)); // 2026-09-21(月) 00:00 JST
  assert.equal(formatJstRange(start, start + WEEK_MS), '9/21（月）〜9/27（日）');
  // 月曜00:00ちょうどは新しい週、1ミリ秒前は前の週
  const monday = Date.UTC(2026, 8, 27, 15, 0);
  assert.equal(jstWeekStart(monday), monday);
  assert.equal(jstWeekStart(monday - 1), start);
});
