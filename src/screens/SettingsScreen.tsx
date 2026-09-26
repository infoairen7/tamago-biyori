// 設定・遊び方
import { useEffect, useState } from 'react';
import type { PublicSettings } from '../sponsor.ts';
import { clearLocalRecords, type Settings } from '../game/storage.ts';
import { audio } from '../game/audio.ts';
import { AppHeader, Button, IconButton } from '../components/ui.tsx';

function Choice<T extends string>({ name, label, value, options, onChange }: { name: string; label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="setting">
      <legend>{label}</legend>
      <div className="segments">
        {options.map(([v, text]) => (
          <label key={v} className={`segment ${value === v ? 'active' : ''}`}>
            <input type="radio" name={name} className="sr-only" checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsScreen({
  settings,
  onChange,
  renderMode,
  renderReason,
  publicSettings,
  rankingConfigured,
  storagePersistent,
  scoringVersion,
  onClose,
  toast,
}: {
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
  renderMode: '3d' | '2d' | null;
  renderReason: string | null;
  publicSettings: PublicSettings;
  rankingConfigured: boolean;
  storagePersistent: boolean;
  scoringVersion: string;
  onClose: () => void;
  toast: (t: string) => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    document.getElementById('settings-title')?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="screen settings-screen">
      <AppHeader id="settings-title" left={<IconButton icon="back" label="閉じる" onClick={onClose} />} title="遊び方・設定" right={<span className="icon-btn-spacer" />} />
      <div className="settings-body">
        <section aria-labelledby="howto-h">
          <h2 id="howto-h" className="section-title">
            遊び方
          </h2>
          <ol className="howto">
            <li>
              <b>卵と仕上がりを選ぶ</b>
              <span>白い卵・赤い卵・うずら卵。とろり／ほどよく／しっかり、どれでも100点を目指せます。</span>
            </li>
            <li>
              <b>2回タップで卵を割る</b>
              <span>1回目でひび、2回目でパカッ。フライパンに落ちたら中火で調理スタート。</span>
            </li>
            <li>
              <b>火かげんと、ふたで仕上げる</b>
              <span>白身が白くなるのを見ながら、火を調整。ふたをすると黄身が進みやすく、縁の焼き色はつきにくくなります。火を切っても余熱で少し進みます。</span>
            </li>
            <li>
              <b>「お皿にうつす」で採点</b>
              <span>白身40点・黄身40点・焼き色20点。強い焦げや生の白身には上限があります。90秒たつと自動でお皿へ。</span>
            </li>
          </ol>
          <p className="tiny">キーボード：0〜3＝火力（切・弱・中・強）、L＝ふた、S＝お皿にうつす、P＝一時停止、Enter／Space＝卵を割る</p>
          <p className="tiny">これはゲーム用の簡易モデルです。実際の調理時間・温度・安全性の目安ではありません。</p>
        </section>

        <section aria-labelledby="sound-h">
          <h2 id="sound-h" className="section-title">
            音
          </h2>
          <label className="setting slider">
            <span>音量 {Math.round(settings.volume * 100)}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => {
                audio.unlock();
                audio.play('ui');
              }}
            />
          </label>
          <label className="setting check">
            <input type="checkbox" checked={settings.muted} onChange={(e) => onChange({ muted: e.target.checked })} />
            <span>音を消す</span>
          </label>
          {audio.failed && <p className="tiny">この端末では音を再生できないため、静音で遊べます。</p>}
        </section>

        <section aria-labelledby="view-h">
          <h2 id="view-h" className="section-title">
            表示
          </h2>
          <Choice
            name="renderMode"
            label="描画"
            value={settings.renderMode}
            options={[
              ['auto', '自動'],
              ['3d', '3D'],
              ['2d', '軽量2D'],
            ]}
            onChange={(v) => onChange({ renderMode: v })}
          />
          <p className="tiny">
            現在：{renderMode === '3d' ? '3D表示' : renderMode === '2d' ? '軽量表示（2D）' : '未初期化'}
            {renderMode === '2d' && renderReason && renderReason !== 'user' ? '（3Dが使えないため）' : ''}。点数や操作はどちらでも同じです。
          </p>
          <Choice
            name="quality"
            label="画質"
            value={settings.quality}
            options={[
              ['auto', '自動'],
              ['high', '高'],
              ['low', '低'],
            ]}
            onChange={(v) => onChange({ quality: v })}
          />
          <Choice
            name="motion"
            label="動き"
            value={settings.motion}
            options={[
              ['system', '端末に合わせる'],
              ['reduce', '減らす'],
              ['full', '通常'],
            ]}
            onChange={(v) => onChange({ motion: v })}
          />
          <label className="setting check">
            <input type="checkbox" checked={settings.hints} onChange={(e) => onChange({ hints: e.target.checked })} />
            <span>はじめての調理でヒントを表示する</span>
          </label>
        </section>

        <section aria-labelledby="data-h">
          <h2 id="data-h" className="section-title">
            記録とプライバシー
          </h2>
          <p className="tiny">
            自己ベストと設定はこの端末のブラウザにだけ保存します。{!storagePersistent && 'この端末には記録を保存できません（今回の結果は表示できます）。'}
          </p>
          <p className="tiny">ランキング：{rankingConfigured ? 'サーバーに接続する設定です。登録は任意で、表示名だけを公開します。' : 'このサイトではランキングサーバーが未設定です。'}</p>
          <p className="tiny">氏名・メールアドレス・位置情報は使いません。</p>
          {!confirmClear ? (
            <Button variant="outline" className="btn-small" onClick={() => setConfirmClear(true)}>
              端末内の記録を消す
            </Button>
          ) : (
            <div className="two">
              <Button
                variant="dark"
                className="btn-small"
                onClick={() => {
                  clearLocalRecords();
                  setConfirmClear(false);
                  toast('端末内の記録を消しました。');
                }}
              >
                消す
              </Button>
              <Button variant="outline" className="btn-small" onClick={() => setConfirmClear(false)}>
                やめる
              </Button>
            </div>
          )}
          {(publicSettings.privacyUrl || publicSettings.termsUrl) && (
            <p className="tiny links">
              {publicSettings.privacyUrl && (
                <a href={publicSettings.privacyUrl} target="_blank" rel="noopener noreferrer">
                  プライバシーポリシー
                </a>
              )}
              {publicSettings.termsUrl && (
                <a href={publicSettings.termsUrl} target="_blank" rel="noopener noreferrer">
                  利用規約
                </a>
              )}
            </p>
          )}
          <p className="tiny version">採点バージョン {scoringVersion} ・ 仮タイトル</p>
        </section>
      </div>
      <div className="sticky-footer">
        <Button onClick={onClose}>閉じる</Button>
      </div>
    </div>
  );
}
