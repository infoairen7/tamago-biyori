import { useEffect, useState } from 'react';
import { GAME_CONFIG, type EggId, type TargetId } from '../../shared/config.ts';
import type { Selection } from '../appTypes.ts';
import type { Sponsor } from '../sponsor.ts';
import { getLocalBest } from '../game/storage.ts';
import { AppHeader, Button, Icon, IconButton } from '../components/ui.tsx';

const EGG_TEXT: Record<EggId, string> = {
  white: 'まずはこの一個から。',
  brown: '殻の色を変えて、もうひと皿。',
  quail: '小さな一個を、手ぎわよく。',
};

export function SelectScreen({
  initial,
  sponsor,
  starting,
  muted,
  onToggleSound,
  onBack,
  onStart,
}: {
  initial: Selection;
  sponsor: Sponsor | null;
  starting: boolean;
  muted: boolean;
  onToggleSound: () => void;
  onBack: () => void;
  onStart: (s: Selection) => void;
}) {
  const [eggId, setEggId] = useState<EggId>(initial.eggId);
  const [targetId, setTargetId] = useState<TargetId>(initial.targetId);
  const best = getLocalBest(eggId, targetId);
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    document.getElementById('select-title')?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="screen select-screen">
      <AppHeader
        id="select-title"
        left={<IconButton icon="back" label="タイトルへ戻る" onClick={onBack} />}
        title="卵を選ぶ"
        right={<IconButton icon={muted ? 'mute' : 'sound'} label={muted ? '音を出す' : '音を消す'} pressed={!muted} onClick={onToggleSound} />}
      />
      <div className="select-body">
        <div className="select-col">
          <span className="eyebrow">01 / YOUR EGG</span>
          <h2 className="screen-heading">今日は、どの卵？</h2>
          <p className="muted intro">気になる一個を選んでみよう。</p>
          <fieldset className="eggs">
            <legend className="sr-only">卵の種類</legend>
            {GAME_CONFIG.eggs.map((egg) => (
              <label key={egg.id} className={`eggcard ${eggId === egg.id ? 'selected' : ''}`}>
                <input type="radio" name="egg" value={egg.id} checked={eggId === egg.id} onChange={() => setEggId(egg.id)} className="sr-only" />
                <span className="eggthumb">
                  <img
                    src={`${base}assets/${egg.id === 'white' ? 'egg_white' : egg.id === 'brown' ? 'egg_brown' : 'egg_quail'}.webp`}
                    alt=""
                    style={{ height: `${Math.round(72 * egg.visualScale)}px` }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                    }}
                  />
                </span>
                <span className="eggcard-text">
                  <b>{egg.name}</b>
                  <span>{EGG_TEXT[egg.id]}</span>
                </span>
                <span className="choice" aria-hidden="true">
                  {eggId === egg.id && <Icon name="check" size={18} />}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="select-col">
          <fieldset className="targets">
            <legend className="h4">黄身の仕上がり</legend>
            <div className="segments">
              {GAME_CONFIG.targets.map((t) => (
                <label key={t.id} className={`segment ${targetId === t.id ? 'active' : ''}`}>
                  <input type="radio" name="target" value={t.id} checked={targetId === t.id} onChange={() => setTargetId(t.id)} className="sr-only" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="tiny">どの仕上がりでも、100点を目指せます。</p>
          <p className="best-line" aria-live="polite">
            {best ? (
              <>
                この条件の自己ベスト <b>{best.score}点</b>
                <span className="tiny">（この端末）</span>
              </>
            ) : (
              <span className="tiny">この条件はまだ記録がありません。</span>
            )}
          </p>
          {sponsor?.product && (
            <aside className="sponsor-mini" aria-label="PR">
              <span className="pr-label">{sponsor.disclosure}</span>
              <div className="sponsor-mini-body">
                {sponsor.product.imageUrl && <img src={sponsor.product.imageUrl} alt="" />}
                <div>
                  <b>{sponsor.product.name}</b>
                  {sponsor.product.description && <p className="tiny">{sponsor.product.description}</p>}
                  <p className="tiny">{sponsor.companyName}</p>
                </div>
              </div>
            </aside>
          )}
          <div className="footer-spacer" aria-hidden="true" />
        </div>
      </div>
      <div className="sticky-footer">
        <Button onClick={() => onStart({ eggId, targetId })} loading={starting}>
          {starting ? '準備中…' : 'この卵で焼く'} {!starting && <Icon name="arrow" />}
        </Button>
      </div>
    </div>
  );
}
