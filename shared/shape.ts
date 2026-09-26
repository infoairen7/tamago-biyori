// run seedから決まる目玉焼きの形。3D・2D・結果画像で同じ形を使います。
import { rngFor } from './rng.ts';

export interface Lobe {
  k: number;
  amp: number;
  phase: number;
}

export interface EggShape {
  seed: number;
  /** 見た目の大きさ（うずら0.6） */
  scale: number;
  /** 白身の基準半径（cm相当の3D単位） */
  whiteRadius: number;
  /** 黄身の半径 */
  yolkRadius: number;
  /** 黄身の中心オフセット（白身の中心からの位置） */
  yolkX: number;
  yolkZ: number;
  lobes: Lobe[];
  /** 縁のレース状の焼き色や泡の配置用の点列（極座標、白身半径に対する割合） */
  specks: { theta: number; r: number; size: number; tone: number }[];
  bubbles: { theta: number; r: number; size: number; phase: number }[];
}

export const CHICKEN_WHITE_RADIUS = 5.3;
export const CHICKEN_YOLK_RADIUS = 1.55;

export function makeEggShape(seed: number, scale: number): EggShape {
  const rnd = rngFor(seed, 'shape');
  const lobes: Lobe[] = [];
  // 低周波ほど大きく、高周波は細かなゆらぎ
  for (let k = 2; k <= 11; k++) {
    const amp = (k <= 4 ? 0.07 : k <= 7 ? 0.035 : 0.014) * (0.45 + rnd() * 0.75);
    lobes.push({ k, amp, phase: rnd() * Math.PI * 2 });
  }
  const yolkAngle = rnd() * Math.PI * 2;
  const yolkDist = (0.05 + rnd() * 0.12) * CHICKEN_WHITE_RADIUS * scale;

  const srnd = rngFor(seed, 'specks');
  const specks: EggShape['specks'] = [];
  for (let i = 0; i < 140; i++) {
    specks.push({ theta: srnd() * Math.PI * 2, r: 0.82 + srnd() * 0.2, size: 0.012 + srnd() * 0.035, tone: srnd() });
  }
  const brnd = rngFor(seed, 'bubbles');
  const bubbles: EggShape['bubbles'] = [];
  for (let i = 0; i < 28; i++) {
    bubbles.push({ theta: brnd() * Math.PI * 2, r: 0.55 + brnd() * 0.5, size: 0.4 + brnd() * 0.6, phase: brnd() });
  }
  return {
    seed,
    scale,
    whiteRadius: CHICKEN_WHITE_RADIUS * scale,
    yolkRadius: CHICKEN_YOLK_RADIUS * scale,
    yolkX: Math.cos(yolkAngle) * yolkDist,
    yolkZ: Math.sin(yolkAngle) * yolkDist,
    lobes,
    specks,
    bubbles,
  };
}

/** 角度thetaにおける白身の外周半径 */
export function whiteRadiusAt(shape: EggShape, theta: number): number {
  let f = 1;
  for (const l of shape.lobes) f += l.amp * Math.sin(l.k * theta + l.phase);
  return shape.whiteRadius * f;
}

/** 白身の最大半径（テクスチャの範囲決定に使用） */
export function maxWhiteRadius(shape: EggShape): number {
  let m = 0;
  for (let i = 0; i < 360; i++) m = Math.max(m, whiteRadiusAt(shape, (i / 360) * Math.PI * 2));
  return m;
}
