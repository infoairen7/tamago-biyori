// 卵を割る → 調理 → お皿にうつす。描画フレームごとに PlaySession を固定ステップで進めます。
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { HEAT_LEVELS, type HeatLevel } from '../../shared/config.ts';
import { makeEggShape } from '../../shared/shape.ts';
import type { RunInfo } from '../appTypes.ts';
import { PlaySession } from '../game/session.ts';
import { audio } from '../game/audio.ts';
import { track } from '../game/analytics.ts';
import { HEAT_LABELS, HEAT_STATUS, panMood, whiteLabel, yolkLabel } from '../game/feedback.ts';
import { isTutorialSeen, markTutorialSeen, type Settings } from '../game/storage.ts';
import type { SceneHost } from '../render/SceneHost.ts';
import type { RenderView } from '../render/types.ts';
import { AppHeader, Button, Dialog, IconButton, Icon } from '../components/ui.tsx';

type PauseKind = null | 'manual' | 'hidden' | 'context' | 'fallback';

const HEAT_ARIA: Record<HeatLevel, string> = { off: '火を切る', low: '弱火', medium: '中火', high: '強火' };

function fmt(sec: number): string {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function PlayScreen({
  run,
  host,
  settings,
  reducedMotion,
  renderMode,
  fallbackNotice,
  onDismissFallback,
  onToggleSound,
  onDone,
  onQuit,
}: {
  run: RunInfo;
  host: SceneHost;
  settings: Settings;
  reducedMotion: boolean;
  renderMode: '3d' | '2d' | null;
  fallbackNotice: string | null;
  onDismissFallback: () => void;
  onToggleSound: () => void;
  onDone: (s: PlaySession) => void;
  onQuit: () => void;
}) {
  const sessionRef = useRef<PlaySession | null>(null);
  if (!sessionRef.current) sessionRef.current = new PlaySession(run.selection.eggId, run.selection.targetId, run.seed, performance.now());
  const session = sessionRef.current;
  const shape = useMemo(() => makeEggShape(run.seed, session.egg.visualScale), [run.seed, session.egg.visualScale]);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [pauseKind, setPauseKind] = useState<PauseKind>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [contextReady, setContextReady] = useState(true);
  const doneRef = useRef(false);
  const pendingPauseRef = useRef(false);
  const cookStartRef = useRef<number | null>(null);
  const tutorial = useRef(settings.hints && !isTutorialSeen());
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [announce, setAnnounce] = useState('');
  const lastLabels = useRef('');

  // 描画先を貼り付け
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    host.attach(el);
    return () => host.detach();
  }, [host]);

  // 見出しにフォーカス（画面遷移の読み上げ）
  useEffect(() => {
    document.getElementById('play-title')?.focus({ preventScroll: true });
  }, []);

  const pause = useCallback(
    (kind: Exclude<PauseKind, null>) => {
      const cookingNow = session.phase === 'cooking' && !session.final;
      if (cookingNow) {
        session.pause();
        audio.setSizzle(0, false);
      }
      if (cookingNow || kind === 'fallback' || kind === 'context') setPauseKind((k) => k ?? kind);
    },
    [session],
  );

  // メインループ：実時間 → 固定ステップ。描画FPSは点数に影響しない。
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const intervals: number[] = [];
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const out = session.tick(now, dt);
      if (out.landed) {
        audio.play('egg_drop');
        cookStartRef.current = now;
        track('game_start', { eggId: session.eggId, targetId: session.targetId, online: run.ticket !== null });
        if (pendingPauseRef.current) {
          pendingPauseRef.current = false;
          pause('hidden');
        }
        refresh();
      }
      if (out.stopped === 'timeout') {
        audio.play('plate');
        audio.setSizzle(0, false);
        refresh();
      }
      if (out.platingDone && !doneRef.current) {
        doneRef.current = true;
        audio.stopSizzle();
        if (tutorial.current) markTutorialSeen();
        onDoneRef.current(session);
        return;
      }
      if (session.phase === 'cooking' && !session.paused) {
        const c = session.cook;
        audio.setSizzle(Math.min(1, 0.15 + c.T * 0.9) * (0.5 + 0.5 * Math.min(1, c.W * 2)), c.lidClosed);
      }
      const r = host.renderer;
      if (r && !host.isContextLost) {
        const view: RenderView = {
          phase: session.phase,
          phaseTime: (now - session.phaseStartedAt) / 1000,
          time: now / 1000,
          egg: session.egg,
          shape,
          cook: session.cook,
          paused: session.paused,
          reducedMotion: reducedRef.current,
        };
        r.render(view);
      }
      // 自動画質：実フレーム間隔が長い状態が続いたら下げる
      if (session.phase === 'cooking' && !session.paused) {
        intervals.push(dt);
        if (intervals.length > 90) intervals.shift();
        if (intervals.length === 90) {
          const sorted = [...intervals].sort((a, b) => a - b);
          if (sorted[45] > 1 / 24) {
            host.degradeQuality();
            intervals.length = 0;
          }
        }
      }
      if (now - lastHud > 100) {
        lastHud = now;
        refresh();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      audio.setSizzle(0, false);
    };
  }, [host, session, shape, run.ticket, pause]);

  // バックグラウンド移行で一時停止。復帰後は「続ける」を押すまで熱を進めない。
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        if (session.phase === 'drop') pendingPauseRef.current = true;
        pause('hidden');
        audio.suspend();
      } else {
        audio.resume();
      }
    };
    const onPageHide = () => {
      if (session.phase === 'drop') pendingPauseRef.current = true;
      pause('hidden');
      audio.suspend();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [session, pause]);

  // 描画コンテキストの喪失・復旧・2D切り替え
  useEffect(
    () =>
      host.on((e) => {
        if (e.type === 'contextLost') {
          pause('context');
          setContextReady(false);
        } else if (e.type === 'contextRestored' || e.type === 'mode') {
          setContextReady(true);
          host.refit();
        }
      }),
    [host, pause],
  );

  useEffect(() => {
    if (fallbackNotice) pause('fallback');
  }, [fallbackNotice, pause]);

  const cont = () => {
    if (fallbackNotice) onDismissFallback();
    session.resume();
    audio.resume();
    setPauseKind(null);
    setConfirmQuit(false);
    refresh();
  };

  const tapEgg = () => {
    const before = session.phase;
    if (session.tapEgg(performance.now())) {
      audio.unlock();
      audio.play(before === 'crackReady' ? 'egg_tap' : 'egg_crack');
      refresh();
    }
  };

  const setHeat = (h: HeatLevel) => {
    if (session.setHeat(h)) {
      audio.play('ui');
      refresh();
    }
  };

  const toggleLid = () => {
    const next = !session.cook.lidClosed;
    if (session.setLid(next)) {
      audio.play(next ? 'lid_on' : 'lid_off');
      refresh();
    }
  };

  const plate = () => {
    if (session.plate(performance.now())) {
      audio.play('plate');
      audio.setSizzle(0, false);
      refresh();
    }
  };

  // キーボード：火力0〜3、ふたL、盛り付けS、停止P（入力中・ダイアログ中は無効、長押しは無視）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const phase = session.phase;
      if ((phase === 'crackReady' || phase === 'cracked') && (e.key === 'Enter' || e.key === ' ')) {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'BUTTON' || active.tagName === 'A')) return; // ボタン自身のクリックに任せる
        e.preventDefault();
        tapEgg();
        return;
      }
      if (phase !== 'cooking') return;
      const k = e.key.toLowerCase();
      if (k >= '0' && k <= '3') {
        e.preventDefault();
        setHeat(HEAT_LEVELS[Number(k)]);
      } else if (k === 'l') {
        e.preventDefault();
        toggleLid();
      } else if (k === 's') {
        e.preventDefault();
        plate();
      } else if (k === 'p') {
        e.preventDefault();
        pause('manual');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const phase = session.phase;
  const cook = session.cook;
  const cracking = phase === 'crackReady' || phase === 'cracked' || phase === 'drop';
  const cooking = phase === 'cooking';
  const finished = phase === 'plating' || phase === 'done';
  const elapsed = session.elapsedSeconds;
  const sinceCook = cookStartRef.current !== null ? elapsed : 0;
  const eggTag = `${session.egg.name} · ${session.target.label}`;

  // 観察ラベルの読み上げ（変化したときだけ）
  const labels = cooking ? `白身：${whiteLabel(cook.W)}。黄身：${yolkLabel(cook.Y)}。${cook.D >= 0.08 ? '縁が焦げはじめています。' : ''}` : '';
  useEffect(() => {
    if (labels && labels !== lastLabels.current) {
      lastLabels.current = labels;
      setAnnounce(labels);
    }
  }, [labels]);

  let topHint: string | null = null;
  let bottomHint: string | null = null;
  if (phase === 'crackReady') {
    topHint = '卵を割ってみよう';
    bottomHint = 'タップで、ひびを入れる';
  } else if (phase === 'cracked') {
    topHint = 'もう一度！';
    bottomHint = 'タップで、割る';
  } else if (cooking && !session.paused) {
    if (cook.D >= 0.08) bottomHint = '縁が焦げはじめています';
    else if (tutorial.current && sinceCook < 9) bottomHint = '白身の透明感がなくなるまで待とう';
    else if (tutorial.current && sinceCook < 18) bottomHint = 'ふたをすると黄身が進みやすい';
    else if (sinceCook < 8) bottomHint = '白身の変化を見てみよう';
  } else if (finished) {
    bottomHint = 'お皿にうつしています…';
  }

  const pauseTitle =
    pauseKind === 'hidden'
      ? 'おかえりなさい。'
      : pauseKind === 'context'
        ? contextReady
          ? '表示が戻りました。'
          : '表示を復旧しています…'
        : pauseKind === 'fallback'
          ? '軽量表示で遊べます'
          : '一時停止中';
  const pauseText =
    pauseKind === 'hidden'
      ? '調理は止めてあります。'
      : pauseKind === 'context'
        ? '調理は止めてあります。表示が戻ったら続けられます。'
        : pauseKind === 'fallback'
          ? `${fallbackNotice ?? ''} 点数や操作は3D表示と同じです。`
          : '熱も時間も止まっています。';

  return (
    <div className={`screen play ${cooking ? 'is-cooking' : ''} ${cracking ? 'is-cracking' : ''}`}>
      <AppHeader
        id="play-title"
        left={
          cooking ? (
            <IconButton icon="pause" label="一時停止（P）" onClick={() => pause('manual')} />
          ) : cracking && phase !== 'drop' ? (
            <IconButton icon="back" label="卵選びに戻る" onClick={onQuit} />
          ) : (
            <span className="icon-btn-spacer" />
          )
        }
        title={eggTag}
        right={<IconButton icon={settings.muted ? 'mute' : 'sound'} label={settings.muted ? '音を出す' : '音を消す'} pressed={!settings.muted} onClick={onToggleSound} />}
      />
      <div className="play-body">
        <div className="scene">
          <div className="scene-canvas-wrap" ref={sceneRef} />
          {(phase === 'crackReady' || phase === 'cracked') && (
            <button type="button" className="scene-tap" onClick={tapEgg} aria-label={phase === 'crackReady' ? '卵をタップして、ひびを入れる' : 'もう一度タップして、卵を割る'} />
          )}
          {(cooking || finished) && (
            <div className="pill timer" aria-label={`経過 ${Math.floor(elapsed)}秒`}>
              {fmt(elapsed)} <small>経過</small>
            </div>
          )}
          {(cooking || finished) && <span className="pill target-pill">目標：{session.target.label}</span>}
          {topHint && <span className="pill scene-hint scene-hint-top">{topHint}</span>}
          {bottomHint && (
            <span className={`pill scene-hint scene-hint-bottom ${cook.D >= 0.08 && cooking ? 'is-warn' : ''}`}>
              {cook.D >= 0.08 && cooking && <Icon name="drop" size={16} />}
              {bottomHint}
            </span>
          )}
          {renderMode === '2d' && <span className="lite-badge">軽量表示</span>}
        </div>

        <section className="play-panel" aria-label={cracking ? '卵を割る' : '調理の操作'}>
          <div className="panel-stack">
            <div className={`crack-panel ${cracking ? '' : 'is-hidden'}`} inert={!cracking} aria-hidden={!cracking}>
              <div className="stepdots" aria-hidden="true">
                <b className={phase === 'crackReady' ? 'on' : 'done'}>1</b>
                <span />
                <b className={phase === 'cracked' ? 'on' : phase === 'drop' ? 'done' : ''}>2</b>
              </div>
              <h2 className="crack-title">こん、ぱかっ。</h2>
              <p className="muted center">
                2回タップで、卵を割ります。
                <br />
                割ったら、中火で調理スタート。
              </p>
              <Button onClick={tapEgg} disabled={phase === 'drop'} className="crack-btn">
                {phase === 'crackReady' ? 'タップして、ひびを入れる' : phase === 'cracked' ? 'もう一度タップして、割る' : 'じゅわっ…'}
              </Button>
              <p className="tiny center kbd-hint">Enter / Space でも割れます</p>
            </div>
            <div className={`cook-panel ${cracking ? 'is-hidden' : ''}`} inert={cracking} aria-hidden={cracking}>
              <div className="desk-only">
                <span className="eyebrow">ON THE PAN</span>
                <h2 className="panel-mood">{finished ? 'いい香り。' : panMood(cook.W, cook.D)}</h2>
                <span className="desktag">
                  {session.egg.name} × {session.target.label}
                </span>
              </div>
              <div className="status" aria-hidden="true">
                <span>
                  <small>白身</small>
                  <b>{whiteLabel(cook.W)}</b>
                </span>
                <span>
                  <small>黄身</small>
                  <b>{yolkLabel(cook.Y)}</b>
                </span>
              </div>
              <div className="controltitle">
                <b id="heat-label">火かげん</b>
                <span>{HEAT_STATUS[cook.heat]}</span>
              </div>
              <div className="heat" role="group" aria-labelledby="heat-label">
                {HEAT_LEVELS.map((h, i) => (
                  <button
                    key={h}
                    type="button"
                    className="heat-btn"
                    aria-pressed={cook.heat === h}
                    aria-label={`${HEAT_ARIA[h]}（${i}）`}
                    disabled={!cooking || session.paused}
                    onClick={() => setHeat(h)}
                  >
                    {HEAT_LABELS[h]}
                  </button>
                ))}
              </div>
              <button type="button" className="lid-toggle" aria-pressed={cook.lidClosed} disabled={!cooking || session.paused} onClick={toggleLid}>
                <Icon name="lid" />
                <span>ふたをする</span>
                <span className="lid-state">{cook.lidClosed ? '閉じている' : '開いている'}</span>
                <span className="switch" aria-hidden="true" />
              </button>
              <Button variant="yolk" className="plate-btn" disabled={!cooking || session.paused} onClick={plate}>
                お皿にうつす
              </Button>
              <p className="tiny center">火を切っても、余熱で少し進みます。</p>
              <p className="keyboard desk-only">0〜3：火力　L：ふた　S：盛り付け　P：一時停止</p>
            </div>
          </div>
        </section>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <Dialog open={pauseKind !== null} onClose={() => (pauseKind === 'context' && !contextReady ? undefined : cont())} labelledBy="pause-title" dismissible={!(pauseKind === 'context' && !contextReady)}>
        {!confirmQuit ? (
          <>
            <h2 id="pause-title" className="dialog-title">
              {pauseTitle}
            </h2>
            <p className="muted">{pauseText}</p>
            <div className="dialog-actions">
              <Button onClick={cont} disabled={pauseKind === 'context' && !contextReady} loading={pauseKind === 'context' && !contextReady}>
                続ける
              </Button>
              {pauseKind !== 'fallback' && (
                <Button variant="outline" onClick={() => setConfirmQuit(true)}>
                  最初から
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 id="pause-title" className="dialog-title">
              この一皿をやめますか？
            </h2>
            <p className="muted">卵選びに戻ります。このプレイは記録されません。</p>
            <div className="dialog-actions">
              <Button variant="outline" onClick={() => setConfirmQuit(false)}>
                続ける
              </Button>
              <Button
                variant="dark"
                onClick={() => {
                  setPauseKind(null);
                  audio.stopSizzle();
                  onQuit();
                }}
              >
                やめて卵選びへ
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
