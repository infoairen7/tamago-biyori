// 結果：自分の目玉焼き、点数、称号、3項目、一言。再挑戦・X・画像保存/共有・ランキング登録・PR。
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayBasePoints, displayBurnPenalty } from '../../shared/model.ts';
import { normalizeDisplayName, NAME_MAX_GRAPHEMES } from '../../shared/name.ts';
import { formatJstDateTime } from '../../shared/period.ts';
import type { PublishResponse } from '../../shared/api-types.ts';
import type { GameResult, OnlineState } from '../appTypes.ts';
import type { SceneHost } from '../render/SceneHost.ts';
import type { PublicSettings, Sponsor } from '../sponsor.ts';
import { feedbackCause, feedbackComment, scoreTitle } from '../game/feedback.ts';
import { audio } from '../game/audio.ts';
import { track } from '../game/analytics.ts';
import { getDisplayName, saveDisplayName } from '../game/storage.ts';
import { buildCopyText, buildHashtags, buildShareText, buildXIntentUrl } from '../share/shareText.ts';
import { buildResultImage, canShareFile, isLowMemoryDevice, triggerDownload, type ResultImage } from '../share/resultImage.ts';
import { ranking, RankingError } from '../online/ranking.ts';
import { AppHeader, Button, Dialog, Icon, IconButton } from '../components/ui.tsx';

type ImageState = { kind: 'preparing' } | { kind: 'ready'; image: ResultImage } | { kind: 'error' };

function canvasToUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    try {
      c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : c.toDataURL('image/png')), 'image/png');
    } catch {
      resolve('');
    }
  });
}

export function ResultScreen({
  result,
  online,
  host,
  sponsor,
  publicSettings,
  reducedMotion,
  muted,
  onToggleSound,
  toast,
  onReplay,
  onRetryFinish,
  onPublished,
  onRanking,
  onSettings,
  onTitle,
}: {
  result: GameResult;
  online: OnlineState;
  host: SceneHost;
  sponsor: Sponsor | null;
  publicSettings: PublicSettings;
  reducedMotion: boolean;
  muted: boolean;
  onToggleSound: () => void;
  toast: (t: string) => void;
  onReplay: () => void;
  onRetryFinish: () => void;
  onPublished: (p: PublishResponse) => void;
  onRanking: () => void;
  onSettings: () => void;
  onTitle: () => void;
}) {
  const { final, egg, target, shape } = result;
  const b = final.breakdown;
  const score = b.score;
  const title = scoreTitle(score);
  const parts = displayBasePoints(b);
  const penalty = displayBurnPenalty(b);
  const cause = feedbackCause(final.cook, b, target.targetY);
  const comment = feedbackComment(cause);
  const [plateUrl, setPlateUrl] = useState<string>('');
  const [img, setImg] = useState<ImageState>({ kind: 'preparing' });
  const [shownScore, setShownScore] = useState(reducedMotion ? score : 0);
  const [preview, setPreview] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const imgAttempt = useRef(0);
  const [retryKey, setRetryKey] = useState(0);

  const hashtags = useMemo(() => buildHashtags(publicSettings.shareHashtag), [publicSettings.shareHashtag]);
  const publicUrl = (import.meta.env.VITE_PUBLIC_GAME_URL ?? '').trim() || publicSettings.publicGameUrl;
  const shareText = buildShareText({ score, eggName: egg.name, targetLabel: target.label, title });
  const verified = online.kind === 'verified' ? online : null;
  const published = verified?.published ?? null;

  useEffect(() => {
    document.getElementById('result-title')?.focus({ preventScroll: true });
    if (score >= 75) audio.play('result_good');
  }, [score]);

  // 点数のカウントアップ
  useEffect(() => {
    if (reducedMotion) {
      setShownScore(score);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      setShownScore(Math.round(score * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [score, reducedMotion]);

  // 皿の画像（確定した状態から描画）
  useEffect(() => {
    let url = '';
    let alive = true;
    const canvas = host.snapshot(final.cook, egg, shape, 800, 540);
    void canvasToUrl(canvas).then((u) => {
      if (!alive) {
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setPlateUrl(u);
    });
    return () => {
      alive = false;
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [host, final, egg, shape]);

  // 共有画像（1200×630）を先に用意しておく（タップ直後に共有を呼べるように）
  const rankLine = published?.weekly ? `週間 ${published.weekly.rank}位（${formatJstDateTime(published.fetchedAt)}時点）` : null;
  useEffect(() => {
    let alive = true;
    let made: ResultImage | null = null;
    imgAttempt.current += 1;
    setImg({ kind: 'preparing' });
    (async () => {
      try {
        const plate = host.snapshot(final.cook, egg, shape, 1050, 800);
        const image = await buildResultImage(
          {
            plate,
            score,
            title,
            eggName: egg.name,
            targetLabel: target.label,
            parts,
            rankLine,
            sponsor: sponsor ? { disclosure: sponsor.disclosure, companyName: sponsor.companyName, logoUrl: sponsor.logoUrl } : null,
          },
          isLowMemoryDevice(),
        );
        made = image;
        if (alive) setImg({ kind: 'ready', image });
        else URL.revokeObjectURL(image.url);
      } catch (e) {
        console.warn('[result] image failed', e);
        if (alive) setImg({ kind: 'error' });
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, final, retryKey, rankLine, sponsor]);

  // Xの投稿画面はリンクで開く（ポップアップブロックを避け、ゲーム画面は残す）
  const xIntentUrl = buildXIntentUrl(shareText, publicUrl, hashtags);
  const onXClick = () => track('x_intent_open', { score });

  const saveImage = () => {
    if (img.kind !== 'ready') return;
    track('result_image_save_click', { score });
    const ok = triggerDownload(img.image.url, img.image.file.name);
    if (ok) toast('画像を保存します。Xでは投稿画面で画像を添付してください。');
    else setPreview(true);
  };

  const shareImage = async () => {
    if (img.kind !== 'ready') return;
    track('native_share_open', { score });
    try {
      await navigator.share({ files: [img.image.file], text: buildCopyText(shareText, publicUrl, hashtags), title: 'たまご日和' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // キャンセルは何もしない
      toast('共有できませんでした。画像を保存してお使いください。');
      setPreview(true);
    }
  };

  const copyText = async () => {
    const text = buildCopyText(shareText, publicUrl, hashtags);
    try {
      await navigator.clipboard.writeText(text);
      toast('結果の文をコピーしました。');
    } catch {
      setCopyFallback(text);
      setPreview(true);
    }
  };

  const canShare = img.kind === 'ready' && canShareFile(img.image.file);

  const onlineLine = (() => {
    switch (online.kind) {
      case 'pending':
        return <p className="online-line">記録を確認中…</p>;
      case 'verified':
        if (online.result.score !== score) {
          return <p className="online-line">サーバーの判定は {online.result.score}点でした。ランキングにはこの点数で載ります。</p>;
        }
        return null;
      case 'failed':
        return (
          <div className="online-line">
            <p>記録の送信に失敗しました。{online.message}</p>
            <Button variant="outline" className="btn-small" onClick={onRetryFinish}>
              もう一度送信する
            </Button>
          </div>
        );
      case 'local':
        if (online.reason === 'not_configured') return <p className="online-line tiny">このプレイは端末内の記録です（ランキングはこのサイトでは未接続です）。</p>;
        if (online.reason === 'expired') return <p className="online-line tiny">記録の有効期限が切れたため、このプレイは端末内の記録として残ります。</p>;
        if (online.reason === 'rejected') return <p className="online-line tiny">この記録はランキングに登録できませんでした。{online.message} 端末内の記録として残ります。</p>;
        return <p className="online-line tiny">このプレイは端末内の記録です。オンラインで始めるとランキングに参加できます。</p>;
    }
  })();

  return (
    <div className="screen result-screen">
      <AppHeader
        id="result-title"
        left={<IconButton icon="back" label="タイトルへ" onClick={onTitle} />}
        title="焼き上がり"
        right={<IconButton icon={muted ? 'mute' : 'sound'} label={muted ? '音を出す' : '音を消す'} pressed={!muted} onClick={onToggleSound} />}
      />
      <div className="result-body">
        <div className="result-visual">
          <span className="eyebrow">YOUR SUNNY-SIDE UP</span>
          <h2 className="result-heading">{title}</h2>
          <div className="score" aria-hidden="true">
            <strong>{shownScore}</strong>
            <span>点</span>
          </div>
          <p className="sr-only" aria-live="polite">
            {`${score}点。${title}`}
          </p>
          <div className="plate-frame">
            {plateUrl ? <img className="plate-img" src={plateUrl} alt={`お皿の目玉焼き（${egg.name}、${target.label}、${score}点）`} /> : <div className="plate-img plate-placeholder" />}
          </div>
          <div className="resulttag">
            {egg.name} × {target.label}
          </div>
        </div>
        <div className="result-info">
          <div className="breakdown" role="group" aria-label="3項目の基礎点">
            <span>
              白身
              <b>
                {parts.white}
                <small>/40</small>
              </b>
            </span>
            <span>
              黄身
              <b>
                {parts.yolk}
                <small>/40</small>
              </b>
            </span>
            <span>
              焼き色
              <b>
                {parts.brown}
                <small>/20</small>
              </b>
            </span>
          </div>
          {(penalty > 0 || b.cap) && (
            <p className="adjust">
              基礎点 {parts.total}
              {penalty > 0 && <> → 焦げ −{penalty}</>}
              {b.cap && <> → {b.cap.kind === 'rawWhite' ? '白身が生のため' : '強い焦げのため'}上限{b.cap.value}点</>} → <b>{score}点</b>
            </p>
          )}
          <p className="resultcomment">{comment}</p>
          {final.reason === 'timeout' && <p className="tiny center">90秒たったので、お皿にうつしました。</p>}
          <p className="best-badge">
            {result.best.isNewBest ? (
              <>
                <Icon name="trophy" size={16} /> 自己ベスト更新！<span className="tiny">（この端末）</span>
              </>
            ) : (
              <>
                この条件の自己ベスト {result.best.previous?.score}点<span className="tiny">（この端末）</span>
              </>
            )}
          </p>
          {!result.storagePersistent && <p className="tiny center warn-text">この端末には記録を保存できません。今回の結果は表示できます。</p>}

          <div className="resultactions">
            <Button onClick={onReplay}>もう一度焼く</Button>
            <div className="two">
              <a className="btn btn-dark" href={xIntentUrl} target="_blank" rel="noopener noreferrer" onClick={onXClick}>
                Xにポスト
              </a>
              <Button variant="outline" onClick={saveImage} disabled={img.kind !== 'ready'} loading={img.kind === 'preparing'}>
                {img.kind === 'preparing' ? (
                  '画像を準備中'
                ) : (
                  <>
                    <Icon name="download" size={18} /> 画像を保存
                  </>
                )}
              </Button>
            </div>
            {canShare && (
              <Button variant="outline" className="btn-small" onClick={() => void shareImage()}>
                <Icon name="share" size={18} /> 画像を共有
              </Button>
            )}
            {img.kind === 'error' && (
              <div className="inline-error" role="alert">
                <p>画像を作れませんでした。</p>
                <div className="two">
                  <Button variant="outline" className="btn-small" onClick={() => setRetryKey((k) => k + 1)}>
                    もう一度
                  </Button>
                  <Button variant="outline" className="btn-small" onClick={() => void copyText()}>
                    結果の文をコピー
                  </Button>
                </div>
              </div>
            )}
            <div className="textlinks">
              <button type="button" className="textbtn" onClick={() => setPreview(true)} disabled={img.kind !== 'ready'}>
                <Icon name="image" size={16} /> シェア画像を見る
              </button>
              <button type="button" className="textbtn" onClick={() => void copyText()}>
                <Icon name="copy" size={16} /> 結果の文をコピー
              </button>
            </div>
            <p className="tiny center">Xへ画像を付けるときは、画像を保存してから投稿画面で添付してください。</p>

            {onlineLine}
            {verified && !published && online.kind === 'verified' && online.result.score === score && (
              <button type="button" className="textlink" onClick={() => setPublishOpen(true)}>
                ランキングに登録する →
              </button>
            )}
            {published && (
              <p className="online-line">
                <span>
                  ランキングに登録しました
                  {published.weekly && (
                    <>
                      ：週間 <b>{published.weekly.rank}位</b>／{published.weekly.total}人（{formatJstDateTime(published.fetchedAt)}時点）
                    </>
                  )}
                </span>
              </p>
            )}
            <button type="button" className="textlink" onClick={onRanking}>
              <Icon name="trophy" size={16} /> ランキングを見る
            </button>
            <button type="button" className="textlink subtle" onClick={onSettings}>
              <Icon name="gear" size={16} /> 設定
            </button>
          </div>

          {sponsor?.product && (
            <aside className="brandbox" aria-label="PR 商品紹介">
              <span className="pr-label">
                {sponsor.disclosure}：{sponsor.companyName}
              </span>
              <b className="brand-headline">{sponsor.headline}</b>
              <div className="brand-product">
                {sponsor.product.imageUrl && <img src={sponsor.product.imageUrl} alt="" />}
                <div>
                  <b>{sponsor.product.name}</b>
                  {sponsor.product.description && <p>{sponsor.product.description}</p>}
                </div>
              </div>
              <a
                className="brand-cta"
                href={sponsor.product.url}
                target="_blank"
                rel="sponsored noopener noreferrer"
                onClick={() => track('sponsor_click', { productId: sponsor.product?.name ?? '', campaignId: sponsor.campaignId })}
              >
                {sponsor.ctaLabel} <Icon name="external" size={16} />
              </a>
            </aside>
          )}
        </div>
      </div>

      <Dialog open={preview} onClose={() => { setPreview(false); setCopyFallback(null); }} labelledBy="preview-title" className="sheet">
        <h2 id="preview-title" className="dialog-title">
          シェア画像
        </h2>
        {img.kind === 'ready' && <img className="share-preview" src={img.image.url} alt={`結果画像：${score}点 ${title}`} />}
        <p className="tiny">画像を保存できないときは、画像を長押し（右クリック）して保存してください。Xへは、保存した画像を投稿画面で添付できます。</p>
        {copyFallback && (
          <label className="copy-fallback">
            <span className="tiny">下の文を選んでコピーしてください。</span>
            <textarea readOnly value={copyFallback} rows={5} onFocus={(e) => e.currentTarget.select()} />
          </label>
        )}
        <div className="dialog-actions">
          <Button variant="outline" onClick={saveImage} disabled={img.kind !== 'ready'}>
            <Icon name="download" size={18} /> 画像を保存
          </Button>
          {canShare && (
            <Button variant="outline" onClick={() => void shareImage()}>
              <Icon name="share" size={18} /> 画像を共有
            </Button>
          )}
          <a className="btn btn-dark" href={xIntentUrl} target="_blank" rel="noopener noreferrer" onClick={onXClick}>
            Xにポスト
          </a>
          <Button variant="ghost" onClick={() => { setPreview(false); setCopyFallback(null); }}>
            閉じる
          </Button>
        </div>
      </Dialog>

      {verified && (
        <PublishDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          resultId={verified.result.resultId}
          onPublished={(p) => {
            onPublished(p);
            track('leaderboard_publish', { score: p.result.score });
            setPublishOpen(false);
            toast(p.weekly ? `ランキングに登録しました（週間 ${p.weekly.rank}位）` : 'ランキングに登録しました');
          }}
        />
      )}
    </div>
  );
}

function PublishDialog({ open, onClose, resultId, onPublished }: { open: boolean; onClose: () => void; resultId: string; onPublished: (p: PublishResponse) => void }) {
  const [name, setName] = useState(getDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = normalizeDisplayName(name);
  const submit = async () => {
    if (busy) return;
    if (!check.ok) {
      setError(check.error === 'too_long' ? `名前は${NAME_MAX_GRAPHEMES}文字以内で入力してください。` : '名前を入力してください。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await ranking.publish(resultId, check.name);
      saveDisplayName(check.name);
      onPublished(p);
    } catch (e) {
      setError(e instanceof RankingError ? e.message : 'ランキングに接続できません。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} labelledBy="publish-title" className="sheet">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="publish-title" className="dialog-title">
          ランキングに登録
        </h2>
        <label className="field">
          <span>表示名（{NAME_MAX_GRAPHEMES}文字まで）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoComplete="nickname" enterKeyHint="done" aria-invalid={error !== null} aria-describedby="publish-note" />
        </label>
        <p id="publish-note" className="tiny">
          表示名は公開されます。本名や連絡先など、個人を特定できる情報は入れないでください。
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="submit" loading={busy}>
            登録する
          </Button>
          <Button variant="ghost" onClick={onClose}>
            やめる
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
