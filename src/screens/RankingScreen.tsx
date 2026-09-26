// 公開ランキング。サーバー未接続のときは架空の参加者で埋めず「ランキングに接続できません」と表示します。
import { useCallback, useEffect, useState } from 'react';
import { GAME_CONFIG, type EggId, type TargetId } from '../../shared/config.ts';
import { formatJstDateTime, formatJstRange } from '../../shared/period.ts';
import type { LeaderboardResponse, Period } from '../../shared/api-types.ts';
import type { Selection } from '../appTypes.ts';
import { ranking, RankingError } from '../online/ranking.ts';
import { getLocalBest } from '../game/storage.ts';
import { AppHeader, Button, EmptyState, Icon, IconButton } from '../components/ui.tsx';

type LoadState = { kind: 'loading' } | { kind: 'ok'; data: LeaderboardResponse } | { kind: 'error'; message: string; notConfigured: boolean };

export function RankingScreen({ initial, onBack, onPlay }: { initial: { selection: Selection; period: Period }; onBack: () => void; onPlay: (s: Selection) => void }) {
  const [eggId, setEggId] = useState<EggId>(initial.selection.eggId);
  const [targetId, setTargetId] = useState<TargetId>(initial.selection.targetId);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const egg = GAME_CONFIG.eggs.find((e) => e.id === eggId)!;
  const target = GAME_CONFIG.targets.find((t) => t.id === targetId)!;
  const localBest = getLocalBest(eggId, targetId);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const data = await ranking.leaderboard(eggId, targetId, period, GAME_CONFIG.scoringVersion);
      setState({ kind: 'ok', data });
    } catch (e) {
      const err = e instanceof RankingError ? e : null;
      setState({ kind: 'error', message: err?.message ?? 'ランキングに接続できません。', notConfigured: err?.code === 'not_configured' });
    }
  }, [eggId, targetId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.getElementById('ranking-title')?.focus({ preventScroll: true });
  }, []);

  const data = state.kind === 'ok' ? state.data : null;
  const rangeText = data?.range ? `${formatJstRange(data.range.start, data.range.end)} · 日本時間` : period === 'all' ? '全期間 · 日本時間' : '';

  return (
    <div className="screen ranking-screen">
      <AppHeader id="ranking-title" left={<IconButton icon="back" label="戻る" onClick={onBack} />} title="焼き上がりランキング" right={<span className="icon-btn-spacer" />} />
      <div className="rank-body">
        <span className="eyebrow">A GOOD EGG, A GREAT SCORE.</span>
        <h2 className="screen-heading">{period === 'weekly' ? '今週の、いいひと皿。' : 'これまでの、いいひと皿。'}</h2>
        <p className="muted intro">同じ卵・仕上がりで腕くらべ。</p>
        <fieldset className="segments two-items">
          <legend className="sr-only">期間</legend>
          {(
            [
              ['weekly', '週間'],
              ['all', '全期間'],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className={`segment ${period === id ? 'active' : ''}`}>
              <input type="radio" name="period" className="sr-only" checked={period === id} onChange={() => setPeriod(id)} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="filters">
          <label>
            <span className="sr-only">卵</span>
            <select value={eggId} onChange={(e) => setEggId(e.target.value as EggId)}>
              {GAME_CONFIG.eggs.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">仕上がり</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value as TargetId)}>
              {GAME_CONFIG.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="tiny period">
          {period === 'weekly' ? '週間' : '全期間'}・{egg.name}・{target.label}
          {rangeText && ` ｜ ${rangeText}`}
        </p>

        <div aria-live="polite" aria-busy={state.kind === 'loading'}>
          {state.kind === 'loading' && (
            <div className="ranklist loading" aria-label="読み込み中">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rankrow skeleton" />
              ))}
            </div>
          )}
          {state.kind === 'error' && (
            <EmptyState title="ランキングに接続できません。" text={state.notConfigured ? 'このサイトではランキングサーバーが設定されていません。' : '通信状態を確認して、もう一度お試しください。'}>
              <Button variant="outline" className="btn-small" onClick={() => void load()}>
                再読込
              </Button>
              <Button variant="ghost" className="btn-small" onClick={onBack}>
                戻る
              </Button>
            </EmptyState>
          )}
          {data && data.entries.length === 0 && <EmptyState title="最初のひと皿を投稿しよう" text="この条件では、まだ誰も登録していません。" />}
          {data && data.entries.length > 0 && (
            <ol className="ranklist">
              {data.entries.map((e, i) => (
                <li key={`${e.rank}-${i}`} className={`rankrow ${e.isMe ? 'me' : ''}`}>
                  <span className="ranknum">{e.rank}</span>
                  <span className="avatar" aria-hidden="true">
                    <Icon name="drop" size={16} />
                  </span>
                  <b className="rankname">{e.displayName}</b>
                  {e.isMe && <span className="me-tag">あなた</span>}
                  <strong>
                    {e.score}
                    <small>点</small>
                  </strong>
                </li>
              ))}
            </ol>
          )}
          {data && (
            <div className="mybest">
              {data.me ? (
                <>
                  <span>あなたの{period === 'weekly' ? '今週の' : ''}ベスト</span>
                  <b>
                    {data.me.rank}位 <i>{data.me.score}点</i>
                  </b>
                </>
              ) : (
                <span>この条件で記録をつくろう</span>
              )}
            </div>
          )}
          {data && <p className="tiny center">{formatJstDateTime(data.fetchedAt)} 時点。順位は変わることがあります。</p>}
        </div>
        {localBest && (
          <p className="tiny center local-note">
            この端末の自己ベスト：{localBest.score}点（端末内の記録で、ランキングとは別です）
          </p>
        )}
      </div>
      <div className="sticky-footer">
        <Button onClick={() => onPlay({ eggId, targetId })}>
          もうひと皿、焼いてみる <Icon name="arrow" />
        </Button>
      </div>
    </div>
  );
}
