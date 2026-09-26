// 画面遷移とアプリ全体の状態。ゲームの計算は shared/ と game/session.ts にあり、ここは流れだけを扱います。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GAME_CONFIG } from '../shared/config.ts';
import { makeEggShape } from '../shared/shape.ts';
import { randomSeed } from '../shared/rng.ts';
import type { Period } from '../shared/api-types.ts';
import type { GameResult, OnlineState, RunInfo, ScreenName, Selection } from './appTypes.ts';
import { audio } from './game/audio.ts';
import { track } from './game/analytics.ts';
import {
  applyUnlocks,
  getLastSelection,
  getPlays,
  loadSettings,
  recordLocalBest,
  recordPlay,
  saveLastSelection,
  saveSettings,
  store,
  unlocksFor,
  type Settings,
} from './game/storage.ts';
import type { PlaySession } from './game/session.ts';
import { SceneHost } from './render/SceneHost.ts';
import { ranking, RankingError } from './online/ranking.ts';
import { loadSponsor, parseSponsor, type PublicSettings, type Sponsor } from './sponsor.ts';
import { Button, Dialog, Toasts, type ToastItem } from './components/ui.tsx';
import { TitleScreen } from './screens/TitleScreen.tsx';
import { SelectScreen } from './screens/SelectScreen.tsx';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { ResultScreen } from './screens/ResultScreen.tsx';
import { RankingScreen } from './screens/RankingScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';

function useReducedMotion(setting: Settings['motion']): boolean {
  const [sys, setSys] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const fn = () => setSys(mq.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);
  return setting === 'reduce' ? true : setting === 'full' ? false : sys;
}

const FALLBACK_TEXT: Record<string, string> = {
  webgl2_unavailable: 'この端末・ブラウザでは3D表示が使えないため、軽量表示で遊べます。',
  init_failed: '3D表示を開始できなかったため、軽量表示で遊べます。',
  context_lost: '3D表示が復旧しなかったため、軽量表示に切り替えました。',
};

export function App() {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<ScreenName>('title');
  const [returnTo, setReturnTo] = useState<ScreenName>('title');
  const [selection, setSelection] = useState<Selection>(getLastSelection);
  const [plays, setPlays] = useState<number>(getPlays);
  const unlocks = useMemo(() => unlocksFor(plays, settings.unlockAll), [plays, settings.unlockAll]);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [online, setOnline] = useState<OnlineState>({ kind: 'local', reason: 'not_configured' });
  const [sponsorState, setSponsorState] = useState<{ sponsor: Sponsor | null; settings: PublicSettings }>(() => parseSponsor(null));
  const [starting, setStarting] = useState(false);
  const [renderInfo, setRenderInfo] = useState<{ mode: '3d' | '2d' | null; reason: string | null }>({ mode: null, reason: null });
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [rankingQuery, setRankingQuery] = useState<{ selection: Selection; period: Period }>({ selection, period: 'weekly' });
  const hostRef = useRef<SceneHost | null>(null);
  const reducedMotion = useReducedMotion(settings.motion);

  const host = useMemo(() => {
    if (!hostRef.current) hostRef.current = new SceneHost(settings.renderMode, settings.quality);
    return hostRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      host.on((e) => {
        if (e.type === 'mode') {
          setRenderInfo({ mode: e.mode, reason: e.reason });
          if (e.mode === '2d' && e.reason && e.reason !== 'user') {
            setFallbackNotice(FALLBACK_TEXT[e.reason] ?? '3D表示で問題が起きたため、軽量表示に切り替えました。');
          }
        }
      }),
    [host],
  );

  useEffect(() => {
    void loadSponsor().then(setSponsorState);
  }, []);

  useEffect(() => {
    audio.setVolume(settings.volume);
    audio.setMuted(settings.muted);
  }, [settings.volume, settings.muted]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduce' : 'full';
  }, [reducedMotion]);

  // 検証用フック（本番の動作には影響しません）
  useEffect(() => {
    (window as unknown as { __tamago?: unknown }).__tamago = {
      host,
      loseContext: () => host.debugLoseContext(),
      get mode() {
        return host.mode;
      },
    };
  }, [host]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        if (patch.renderMode !== undefined || patch.quality !== undefined) host.configure(next.renderMode, next.quality);
        return next;
      });
    },
    [host],
  );

  const go = useCallback((s: ScreenName) => {
    setScreen(s);
    window.scrollTo(0, 0);
  }, []);

  const openSettings = (from: ScreenName) => {
    setReturnTo(from);
    go('settings');
  };

  const openRanking = (from: ScreenName, sel: Selection) => {
    setReturnTo(from);
    setRankingQuery({ selection: sel, period: 'weekly' });
    go('ranking');
  };

  // 卵と目標を決めて、runを始める。サーバーがあれば短い待ち時間でrunを発行し、だめならローカル専用。
  const startRun = async (picked: Selection) => {
    audio.unlock();
    // まだ使えないこだわりは基本の値で焼く
    const sel = applyUnlocks(picked, unlocks);
    setSelection(picked);
    saveLastSelection(picked);
    track('egg_select', { eggId: sel.eggId, targetId: sel.targetId, edgeId: sel.edgeId, oilId: sel.oilId, oilAmountId: sel.oilAmountId });
    let info: RunInfo;
    if (ranking.configured) {
      setStarting(true);
      try {
        const ticket = await ranking.createRun(sel);
        info = { key: ticket.runId, seed: ticket.seed >>> 0, selection: sel, ticket, localReason: null, unlocks };
      } catch {
        const seed = randomSeed();
        info = { key: `local-${seed}-${Date.now()}`, seed, selection: sel, ticket: null, localReason: 'offline', unlocks };
      } finally {
        setStarting(false);
      }
    } else {
      const seed = randomSeed();
      info = { key: `local-${seed}-${Date.now()}`, seed, selection: sel, ticket: null, localReason: 'not_configured', unlocks };
    }
    setRun(info);
    host.ensure();
    go('play');
  };

  const submitOnline = useCallback(async (res: GameResult) => {
    const ticket = res.run.ticket;
    if (!ticket) return;
    if (Date.now() > ticket.expiresAt) {
      setOnline({ kind: 'local', reason: 'expired' });
      return;
    }
    setOnline({ kind: 'pending' });
    try {
      const v = await ranking.finish(ticket.runId, res.final.events, res.final.stopStep);
      setOnline({ kind: 'verified', result: v, published: null });
    } catch (e) {
      const err = e instanceof RankingError ? e : new RankingError('network', 'ランキングに接続できません。');
      if (err.code === 'run_expired') setOnline({ kind: 'local', reason: 'expired' });
      else if (err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 408) setOnline({ kind: 'local', reason: 'rejected', message: err.message });
      else setOnline({ kind: 'failed', message: err.message });
    }
  }, []);

  const onPlayDone = (session: PlaySession) => {
    if (!run || !session.final) return;
    const final = session.final;
    const finishedAt = Date.now();
    const best = recordLocalBest(session.recipe, final.breakdown.score, finishedAt);
    const progress = recordPlay(settings.unlockAll);
    setPlays(progress.plays);
    for (const f of progress.newlyUnlocked) track('feature_unlock', { feature: f, plays: progress.plays });
    const res: GameResult = {
      run,
      egg: session.egg,
      target: session.target,
      edge: session.edge,
      oil: session.oil,
      amount: session.amount,
      shape: makeEggShape(run.seed, session.egg.visualScale),
      final,
      finishedAt,
      best,
      storagePersistent: store.persistent,
      newlyUnlocked: progress.newlyUnlocked,
    };
    setResult(res);
    track('game_complete', {
      runKey: run.key,
      score: final.breakdown.score,
      eggId: session.eggId,
      targetId: session.targetId,
      edgeId: session.edge.id,
      oilId: session.oil.id,
      oilAmountId: session.amount.id,
      water: session.waterUsed,
      reason: final.reason,
      render: host.mode ?? 'none',
    });
    if (run.ticket) void submitOnline(res);
    else setOnline({ kind: 'local', reason: run.localReason ?? 'offline' });
    go('result');
  };

  const content = (() => {
    switch (screen) {
      case 'title':
        return (
          <TitleScreen
            sponsor={sponsorState.sponsor}
            onStart={() => {
              audio.unlock();
              go('select');
            }}
            onRanking={() => openRanking('title', selection)}
            onHowTo={() => openSettings('title')}
          />
        );
      case 'select':
        return (
          <SelectScreen
            initial={selection}
            unlocks={unlocks}
            plays={plays}
            sponsor={sponsorState.sponsor}
            starting={starting}
            muted={settings.muted}
            onToggleSound={() => updateSettings({ muted: !settings.muted })}
            onBack={() => go('title')}
            onStart={(sel) => void startRun(sel)}
          />
        );
      case 'play':
        return run ? (
          <PlayScreen
            key={run.key}
            run={run}
            unlocks={run.unlocks}
            plays={plays}
            host={host}
            settings={settings}
            reducedMotion={reducedMotion}
            renderMode={renderInfo.mode}
            fallbackNotice={fallbackNotice}
            onDismissFallback={() => setFallbackNotice(null)}
            onToggleSound={() => {
              audio.unlock();
              updateSettings({ muted: !settings.muted });
            }}
            onDone={onPlayDone}
            onQuit={() => go('select')}
          />
        ) : null;
      case 'result':
        return result ? (
          <ResultScreen
            key={result.run.key}
            result={result}
            online={online}
            host={host}
            sponsor={sponsorState.sponsor}
            publicSettings={sponsorState.settings}
            reducedMotion={reducedMotion}
            muted={settings.muted}
            onToggleSound={() => updateSettings({ muted: !settings.muted })}
            toast={toast}
            onReplay={() => {
              track('replay_start', { eggId: result.egg.id, targetId: result.target.id });
              go('select');
            }}
            onRetryFinish={() => void submitOnline(result)}
            onPublished={(p) => setOnline((o) => (o.kind === 'verified' ? { ...o, published: p } : o))}
            onRanking={() => openRanking('result', result.run.selection)}
            onSettings={() => openSettings('result')}
            onTitle={() => go('title')}
          />
        ) : null;
      case 'ranking':
        return (
          <RankingScreen
            initial={rankingQuery}
            onBack={() => go(returnTo === 'result' && result ? 'result' : 'title')}
            onPlay={(sel) => {
              setSelection((prev) => ({ ...prev, ...sel }));
              go('select');
            }}
          />
        );
      case 'settings':
        return (
          <SettingsScreen
            settings={settings}
            onChange={updateSettings}
            renderMode={renderInfo.mode ?? host.mode}
            renderReason={renderInfo.reason}
            publicSettings={sponsorState.settings}
            rankingConfigured={ranking.configured}
            plays={plays}
            onResetRecords={() => setPlays(0)}
            storagePersistent={store.persistent}
            scoringVersion={GAME_CONFIG.scoringVersion}
            onClose={() => go(returnTo === 'result' && result ? 'result' : 'title')}
            toast={toast}
          />
        );
    }
  })();

  return (
    <div className={`app app-${screen}`}>
      {content}
      <Toasts items={toasts} />
      <Dialog open={fallbackNotice !== null && screen !== 'play'} onClose={() => setFallbackNotice(null)} labelledBy="fallback-title">
        <h2 id="fallback-title" className="dialog-title">
          軽量表示で遊べます
        </h2>
        <p className="muted">{fallbackNotice}</p>
        <p className="tiny">点数や操作は3D表示と同じです。</p>
        <Button onClick={() => setFallbackNotice(null)}>続ける</Button>
      </Dialog>
    </div>
  );
}
