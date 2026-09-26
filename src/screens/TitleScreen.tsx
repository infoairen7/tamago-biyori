import { useEffect } from 'react';
import type { Sponsor } from '../sponsor.ts';
import { Button, EggMark, Icon } from '../components/ui.tsx';

export function TitleScreen({ sponsor, onStart, onRanking, onHowTo }: { sponsor: Sponsor | null; onStart: () => void; onRanking: () => void; onHowTo: () => void }) {
  useEffect(() => {
    document.getElementById('title-heading')?.focus({ preventScroll: true });
  }, []);
  const base = import.meta.env.BASE_URL;
  return (
    <div className="screen title-screen">
      <div className="title-hero">
        <picture>
          <source media="(max-width: 700px)" srcSet={`${base}assets/hero-900.webp`} />
          <img className="title-hero-img" src={`${base}assets/hero.webp`} alt="朝のキッチン。小さな黒いフライパンで、黄身がつややかな目玉焼きが焼けている" fetchPriority="high" />
        </picture>
        <div className="title-hero-text">
          <span className="overline">A LITTLE MORNING, WELL DONE.</span>
          <h1 id="title-heading" tabIndex={-1}>
            <EggMark small />
            たまご日和
          </h1>
          <p className="tagline">
            じゅわっ、とろっ。
            <br />
            今日のひと皿。
          </p>
        </div>
      </div>
      <div className="title-bottom">
        <span className="eyebrow">焼き加減は、あなたしだい。</span>
        <p className="muted title-lead">
          卵を割って、火をととのえて。
          <br />
          理想の目玉焼きをつくろう。
        </p>
        <Button onClick={onStart} className="title-start">
          目玉焼きを焼く <Icon name="arrow" />
        </Button>
        <div className="linkrow">
          <button type="button" className="textbtn" onClick={onRanking}>
            <Icon name="trophy" size={18} /> ランキング
          </button>
          <button type="button" className="textbtn" onClick={onHowTo}>
            <Icon name="gear" size={18} /> 遊び方・設定
          </button>
        </div>
        {sponsor && (
          <div className="sponsorline">
            {sponsor.logoUrl && <img src={sponsor.logoUrl} alt="" className="sponsor-logo" />}
            <span>
              {sponsor.disclosure}：{sponsor.companyName}
            </span>
          </div>
        )}
        <p className="tiny title-note">ゲーム用の簡易モデルです。実際の調理時間や安全の目安ではありません。</p>
      </div>
    </div>
  );
}
