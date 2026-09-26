import { useEffect, useState, type ReactNode } from 'react';
import { GAME_CONFIG, getEdge, getOil, getOilAmount, type EdgeId, type EggId, type OilAmountId, type OilId, type TargetId } from '../../shared/config.ts';
import type { Selection } from '../appTypes.ts';
import type { Sponsor } from '../sponsor.ts';
import { FEATURE_UNLOCK_AT, getLocalBest, getRecipeBook, type Feature, type Unlocks } from '../game/storage.ts';
import { AppHeader, Button, Icon, IconButton } from '../components/ui.tsx';

const EGG_TEXT: Record<EggId, string> = {
  white: 'まずはこの一個から。',
  brown: '殻の色を変えて、もうひと皿。',
  quail: '小さな一個を、手ぎわよく。',
};

export const FEATURE_LABEL: Record<Feature, string> = {
  edge: '縁の焼き目',
  oilAmount: '油の量',
  water: '差し水',
  oilType: '油の種類',
};

function Segments<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  note,
}: {
  name: string;
  legend: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  note?: ReactNode;
}) {
  return (
    <fieldset className="option-group">
      <legend className="h4">{legend}</legend>
      <div className="segments">
        {options.map((o) => (
          <label key={o.id} className={`segment ${value === o.id ? 'active' : ''}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      {note && <p className="option-note">{note}</p>}
    </fieldset>
  );
}

export function SelectScreen({
  initial,
  unlocks,
  plays,
  sponsor,
  starting,
  muted,
  onToggleSound,
  onBack,
  onStart,
}: {
  initial: Selection;
  unlocks: Unlocks;
  plays: number;
  sponsor: Sponsor | null;
  starting: boolean;
  muted: boolean;
  onToggleSound: () => void;
  onBack: () => void;
  onStart: (s: Selection) => void;
}) {
  const [eggId, setEggId] = useState<EggId>(initial.eggId);
  const [targetId, setTargetId] = useState<TargetId>(initial.targetId);
  const [edgeId, setEdgeId] = useState<EdgeId>(initial.edgeId);
  const [oilId, setOilId] = useState<OilId>(initial.oilId);
  const [oilAmountId, setOilAmountId] = useState<OilAmountId>(initial.oilAmountId);
  const best = getLocalBest({ eggId, targetId, edgeId });
  const book = unlocks.edge ? getRecipeBook(eggId) : null;
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    document.getElementById('select-title')?.focus({ preventScroll: true });
  }, []);

  // まだ使えないこだわりと、あと何皿で使えるか
  const locked = (Object.keys(FEATURE_UNLOCK_AT) as Feature[]).filter((f) => !unlocks[f]);
  const nextAt = locked.length ? Math.min(...locked.map((f) => FEATURE_UNLOCK_AT[f])) : null;
  const nextFeatures = locked.filter((f) => FEATURE_UNLOCK_AT[f] === nextAt);
  const edge = getEdge(edgeId);

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
          {book && (
            <section className="recipe-book" aria-labelledby="book-title">
              <h3 className="h4" id="book-title">
                レシピ帳 <span className="tiny">（{GAME_CONFIG.eggs.find((e) => e.id === eggId)?.name}・この端末の自己ベスト）</span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">黄身＼縁</span>
                    </th>
                    {GAME_CONFIG.edgeTargets.map((e) => (
                      <th key={e.id} scope="col">
                        縁 {e.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GAME_CONFIG.targets.map((t) => (
                    <tr key={t.id}>
                      <th scope="row">{t.label}</th>
                      {GAME_CONFIG.edgeTargets.map((e) => {
                        const b = book[`${t.id}:${e.id}`];
                        const current = t.id === targetId && e.id === edgeId;
                        return (
                          <td key={e.id}>
                            <button
                              type="button"
                              className={`book-cell ${current ? 'current' : ''} ${b && b.score >= 90 ? 'great' : ''}`}
                              aria-pressed={current}
                              aria-label={`黄身${t.label}・縁${e.label}：${b ? `${b.score}点` : '記録なし'}`}
                              onClick={() => {
                                setTargetId(t.id);
                                setEdgeId(e.id);
                              }}
                            >
                              {b ? b.score : '—'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
        <div className="select-col">
          <Segments
            name="target"
            legend="黄身の仕上がり"
            options={GAME_CONFIG.targets}
            value={targetId}
            onChange={setTargetId}
          />
          {unlocks.edge && (
            <Segments name="edge" legend="縁の焼き目" options={GAME_CONFIG.edgeTargets} value={edgeId} onChange={setEdgeId} note={edge.description} />
          )}
          {(unlocks.oilType || unlocks.oilAmount) && (
            <div className="prep">
              <span className="eyebrow">02 / 下ごしらえ</span>
              {unlocks.oilType && (
                <Segments
                  name="oil"
                  legend="油"
                  options={GAME_CONFIG.oils.map((o) => ({ id: o.id, label: o.name }))}
                  value={oilId}
                  onChange={setOilId}
                  note={getOil(oilId).description}
                />
              )}
              {unlocks.oilAmount && (
                <Segments
                  name="oil-amount"
                  legend="油の量"
                  options={GAME_CONFIG.oilAmounts.map((o) => ({ id: o.id, label: o.name }))}
                  value={oilAmountId}
                  onChange={setOilAmountId}
                  note={getOilAmount(oilAmountId).description}
                />
              )}
            </div>
          )}
          <p className="tiny">どの組み合わせでも、100点を目指せます。</p>
          {nextAt !== null && (
            <p className="unlock-teaser">
              <Icon name="drop" size={16} />
              <span>
                あと{Math.max(1, nextAt - plays)}皿焼くと「{nextFeatures.map((f) => FEATURE_LABEL[f]).join('」と「')}」が使えるようになります。
              </span>
            </p>
          )}
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
        <Button onClick={() => onStart({ eggId, targetId, edgeId, oilId, oilAmountId })} loading={starting}>
          {starting ? '準備中…' : 'この卵で焼く'} {!starting && <Icon name="arrow" />}
        </Button>
      </div>
    </div>
  );
}
