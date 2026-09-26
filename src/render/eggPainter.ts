// 白身・黄身・殻の見た目を W/Y/B/D と seed から描く共通ペインター。
// 3Dのテクスチャ、2Dの軽量表示、結果画像のすべてがこの関数で同じ見た目を作ります。
import type { EggId } from '../../shared/config.ts';
import { rngFor } from '../../shared/rng.ts';
import { maxWhiteRadius, whiteRadiusAt, type EggShape } from '../../shared/shape.ts';
import { clamp01 } from '../../shared/model.ts';

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** なめらかな値ノイズ（seed固定） */
export function makeValueNoise(seed: number, purpose: string, grid = 24): (x: number, y: number) => number {
  const rnd = rngFor(seed, purpose);
  const vals = new Float32Array(grid * grid);
  for (let i = 0; i < vals.length; i++) vals[i] = rnd();
  const at = (ix: number, iy: number) => vals[(((iy % grid) + grid) % grid) * grid + (((ix % grid) + grid) % grid)];
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = lerp(at(x0, y0), at(x0 + 1, y0), sx);
    const b = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx);
    return lerp(a, b, sy);
  };
}

const RAW_WHITE: RGB = [226, 224, 208];
const COOKED_WHITE: RGB = [255, 252, 243];
const GOLDEN: RGB = [228, 172, 82];
const BROWN: RGB = [158, 94, 40];
const BURNT: RGB = [48, 30, 18];

/**
 * 白身の表面（上から見た図）。テクスチャ用canvasをW/B/Dに応じて塗り直します。
 * 範囲は ±extent（3D単位）の正方形。+x が右、+z が画面手前（キャンバス下方向）。
 */
export class WhiteSurface {
  readonly canvas: HTMLCanvasElement;
  readonly size: number;
  readonly extent: number;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly rho: Float32Array;
  private readonly thick: Float32Array;
  private readonly n1: Float32Array;
  private readonly n2: Float32Array;
  private readonly n3: Float32Array;
  private readonly ring: Float32Array;
  private last = { W: -1, B: -1, D: -1 };

  constructor(shape: EggShape, size: number) {
    this.size = size;
    this.extent = maxWhiteRadius(shape) * 1.06;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.img = ctx.createImageData(size, size);
    const n = size * size;
    this.rho = new Float32Array(n);
    this.thick = new Float32Array(n);
    this.n1 = new Float32Array(n);
    this.n2 = new Float32Array(n);
    this.n3 = new Float32Array(n);
    this.ring = new Float32Array(n);
    const noiseA = makeValueNoise(shape.seed, 'mottle', 32);
    const noiseB = makeValueNoise(shape.seed, 'edge', 48);
    const noiseC = makeValueNoise(shape.seed, 'lace', 64);
    // 角度ごとの外周半径を前計算
    const ANG = 720;
    const edgeR = new Float32Array(ANG);
    for (let i = 0; i < ANG; i++) edgeR[i] = whiteRadiusAt(shape, (i / ANG) * Math.PI * 2);
    const ex = this.extent;
    const yr = shape.yolkRadius;
    for (let py = 0; py < size; py++) {
      const z = ((py + 0.5) / size - 0.5) * 2 * ex;
      for (let px = 0; px < size; px++) {
        const x = ((px + 0.5) / size - 0.5) * 2 * ex;
        const i = py * size + px;
        let th = Math.atan2(z, x);
        if (th < 0) th += Math.PI * 2;
        const re = edgeR[Math.floor((th / (Math.PI * 2)) * ANG) % ANG];
        const r = Math.hypot(x, z);
        const rho = r / re;
        this.rho[i] = rho;
        const dy = Math.hypot(x - shape.yolkX, z - shape.yolkZ) / yr;
        // 黄身の周りほど厚く、縁ほど薄い
        const nearYolk = Math.exp(-Math.pow(Math.max(0, dy - 1) / 1.1, 2));
        this.thick[i] = clamp01(0.55 * Math.pow(clamp01(1 - rho), 0.8) + 0.55 * nearYolk);
        const u = x / ex;
        const v = z / ex;
        this.n1[i] = noiseA(u * 6 + 11, v * 6 + 7) * 0.65 + noiseA(u * 14 + 3, v * 14 + 5) * 0.35;
        this.n2[i] = noiseB(u * 10 + 1, v * 10 + 2) * 0.6 + noiseB(u * 26, v * 26) * 0.4;
        this.n3[i] = noiseC(u * 40 + 9, v * 40 + 4);
        this.ring[i] = Math.exp(-Math.pow((dy - 1.04) / 0.16, 2));
      }
    }
  }

  /** 値が十分に変わったときだけ塗り直します。塗り直したら true。 */
  update(W: number, B: number, D: number, force = false): boolean {
    const l = this.last;
    if (!force && Math.abs(W - l.W) + Math.abs(B - l.B) + Math.abs(D - l.D) < 0.006) return false;
    this.last = { W, B, D };
    const data = this.img.data;
    const n = this.size * this.size;
    const bandW = 0.08 + 0.16 * B + 0.22 * D;
    const edgeStrength = clamp01(B * 4.2 + D * 2);
    const browned = mix(GOLDEN, BROWN, clamp01((B - 0.25) / 0.6));
    const edgeCol = mix(browned, BURNT, clamp01(D * 1.6));
    const laceThresh = 0.74 - 0.3 * B;
    const burnReach = 0.08 + 0.55 * D;
    const burnAmt = clamp01(D * 1.5);
    for (let i = 0; i < n; i++) {
      const rho = this.rho[i];
      const o = i * 4;
      if (rho > 1.03) {
        data[o + 3] = 0;
        continue;
      }
      const n1 = this.n1[i];
      const n2 = this.n2[i];
      const wl = clamp01((W - 0.26 * this.thick[i]) / 0.72 + 0.06 * (n1 - 0.5));
      const cook = smoothstep(0.03, 0.9, wl);
      let alpha = 0.42 + 0.58 * cook;
      const shade = (0.965 + 0.05 * n1) * (1 - 0.1 * this.ring[i] * cook);
      let r = lerp(RAW_WHITE[0], COOKED_WHITE[0], cook) * shade;
      let g = lerp(RAW_WHITE[1], COOKED_WHITE[1], cook) * shade;
      let b = lerp(RAW_WHITE[2], COOKED_WHITE[2], cook) * shade;
      const rhoN = rho + 0.06 * (n2 - 0.5);
      if (edgeStrength > 0) {
        const e = smoothstep(1 - bandW, 1.0, rhoN) * edgeStrength;
        r = lerp(r, edgeCol[0], e);
        g = lerp(g, edgeCol[1], e);
        b = lerp(b, edgeCol[2], e);
        if (B > 0.18 && rhoN > 0.84 && this.n3[i] > laceThresh) {
          const k = 0.55 * e + 0.2 * B;
          r = lerp(r, browned[0] * 0.8, k);
          g = lerp(g, browned[1] * 0.8, k);
          b = lerp(b, browned[2] * 0.8, k);
        }
      }
      if (D > 0.02) {
        const bm = smoothstep(1 - burnReach, 1.0, rhoN + 0.18 * (n1 - 0.5)) * burnAmt;
        r = lerp(r, BURNT[0], bm);
        g = lerp(g, BURNT[1], bm);
        b = lerp(b, BURNT[2], bm);
        alpha = Math.max(alpha, bm);
      }
      alpha *= 1 - smoothstep(0.985, 1.025, rho);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = alpha * 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
    return true;
  }
}

/** 黄身の見た目（色は sRGB） */
export function yolkLook(Y: number): { color: RGB; highlight: RGB; edge: RGB; roughness: number; clearcoat: number; gloss: number } {
  const t = smoothstep(0.05, 0.95, Y);
  const color = mix([250, 138, 10], [242, 190, 84], t);
  const highlight = mix([255, 222, 110], [252, 228, 165], t);
  const edge = mix([226, 112, 4], [218, 158, 56], t);
  return {
    color,
    highlight,
    edge,
    roughness: lerp(0.16, 0.72, t),
    clearcoat: lerp(1, 0.05, smoothstep(0.05, 0.8, Y)),
    gloss: lerp(0.75, 0.1, smoothstep(0.05, 0.85, Y)),
  };
}

export const rgbCss = (c: RGB, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** 2Dで黄身を描く（上から見た楕円） */
export function paintYolk2D(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, Y: number): void {
  const look = yolkLook(Y);
  // 接地の影
  ctx.save();
  ctx.fillStyle = 'rgba(120,80,20,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.06, cy + ry * 0.12, rx * 1.04, ry * 1.02, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.35, rx * 0.05, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, rgbCss(look.highlight));
  g.addColorStop(0.55, rgbCss(look.color));
  g.addColorStop(1, rgbCss(look.edge));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // つや
  ctx.globalAlpha = look.gloss;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.32, cy - ry * 0.38, rx * 0.3, ry * 0.14, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = look.gloss * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.35, cy + ry * 0.3, rx * 0.1, ry * 0.05, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 殻の色設定 */
export function shellColors(eggId: EggId): { base: string; dark: string; speck: string; inner: string } {
  switch (eggId) {
    case 'brown':
      return { base: '#c98a55', dark: '#a86a3a', speck: '#b0703f', inner: '#f3ebdc' };
    case 'quail':
      return { base: '#ecdcbc', dark: '#cdb994', speck: '#4a2a14', inner: '#f5efe2' };
    default:
      return { base: '#f3eee4', dark: '#ddd5c6', speck: '#d9d0bf', inner: '#f8f4ec' };
  }
}

/**
 * 殻のテクスチャ（u=周方向、v=長軸方向）。crackedでひびを描きます。
 */
export function paintShell(canvas: HTMLCanvasElement, eggId: EggId, seed: number, cracked: boolean): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const c = shellColors(eggId);
  const rnd = rngFor(seed, 'shell');
  ctx.fillStyle = c.base;
  ctx.fillRect(0, 0, W, H);
  // ごく細かな色むら
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.05 + rnd() * 0.07;
    ctx.fillStyle = rnd() < 0.5 ? c.dark : '#ffffff';
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, 2 + rnd() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (eggId === 'quail') {
    // まだら模様
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const blob = rnd() < 0.18;
      const n = blob ? 18 : 1;
      for (let k = 0; k < n; k++) {
        ctx.globalAlpha = 0.55 + rnd() * 0.4;
        ctx.fillStyle = c.speck;
        ctx.beginPath();
        ctx.arc(x + (rnd() - 0.5) * (blob ? 34 : 0), y + (rnd() - 0.5) * (blob ? 24 : 0), blob ? 2 + rnd() * 7 : 1 + rnd() * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    for (let i = 0; i < 380; i++) {
      ctx.globalAlpha = 0.18 + rnd() * 0.25;
      ctx.fillStyle = c.speck;
      ctx.beginPath();
      ctx.arc(rnd() * W, rnd() * H, 0.6 + rnd() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  if (cracked) {
    const crnd = rngFor(seed, 'crack');
    const y0 = H * 0.5;
    ctx.lineJoin = 'round';
    for (const [color, width, dy] of [
      ['rgba(255,255,255,0.7)', 3, 1.5],
      ['rgba(60,45,30,0.85)', 1.6, 0],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let y = y0;
      ctx.moveTo(0, y + dy);
      for (let x = 0; x <= W; x += W / 28) {
        y = y0 + (crnd() - 0.5) * H * 0.07;
        ctx.lineTo(x, y + dy);
      }
      ctx.stroke();
    }
    // 小さな枝分かれ
    ctx.strokeStyle = 'rgba(60,45,30,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const x = crnd() * W;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + (crnd() - 0.5) * 18, y0 + (crnd() < 0.5 ? -1 : 1) * (6 + crnd() * 12));
      ctx.stroke();
    }
  }
}
