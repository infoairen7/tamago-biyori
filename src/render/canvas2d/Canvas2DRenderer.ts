// WebGL 2が使えない環境のための軽量2D描画。3Dと同じ GameModel（W/Y/B/D）と seed の形を読みます。
// 点数・操作・画像保存の意味は3Dと同じです。
import type { EggConfig, OilAmountId, OilConfig, OilId } from '../../../shared/config.ts';
import type { FinalCook } from '../../../shared/model.ts';
import type { EggShape } from '../../../shared/shape.ts';
import { rngFor } from '../../../shared/rng.ts';
import { OIL_LOOK, WhiteSurface, paintShell, paintYolk2D, rgbCss, shellColors, smoothstep } from '../eggPainter.ts';
import type { QualityLevel, RenderView, SceneRenderer } from '../types.ts';
import { DROP_MS, PLATING_MS } from '../../game/session.ts';

const ELEV = (52 * Math.PI) / 180;
const SQUASH = Math.sin(ELEV);
const COS_E = Math.cos(ELEV);
const PAN_R = 9.7;
const RIM_Y = 2.85;

interface Steam {
  x: number;
  z: number;
  born: number;
  life: number;
  drift: number;
  size: number;
}

export class Canvas2DRenderer implements SceneRenderer {
  readonly kind = '2d' as const;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 1;
  private h = 1;
  private surface: WhiteSurface | null = null;
  private surfaceKey = '';
  private shellCanvas: HTMLCanvasElement;
  private shellKey = '';
  private steam: Steam[] = [];
  private lastSteamAt = 0;
  private lidAnim = 0;
  private lastTime = 0;
  private quality: QualityLevel;
  private background: HTMLCanvasElement | null = null;

  constructor(quality: QualityLevel) {
    this.quality = quality;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene-canvas';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.shellCanvas = document.createElement('canvas');
    this.shellCanvas.width = 256;
    this.shellCanvas.height = 128;
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1);
    this.w = Math.max(1, Math.round(width * this.dpr));
    this.h = Math.max(1, Math.round(height * this.dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.background = null;
  }

  private projection(scaleBoost = 1) {
    const w = this.w;
    const h = this.h;
    // パンの直径がプレイ領域の約6〜8割になるように
    const panPx = Math.min(w * 0.82, (h * 0.66) / SQUASH) * scaleBoost;
    const k = panPx / (PAN_R * 2);
    const cx = w * 0.5;
    const cy = h * 0.6;
    return { k, cx, cy, sx: (x: number) => cx + x * k, sy: (y: number, z: number) => cy + z * k * SQUASH - y * k * COS_E };
  }

  private ensureSurface(shape: EggShape): WhiteSurface {
    const key = `${shape.seed}:${shape.scale}:${this.quality}`;
    if (!this.surface || this.surfaceKey !== key) {
      this.surface = new WhiteSurface(shape, this.quality === 'high' ? 320 : 224);
      this.surfaceKey = key;
    }
    return this.surface;
  }

  private ensureShell(egg: EggConfig, seed: number, cracked: boolean) {
    const key = `${egg.id}:${seed}:${cracked}`;
    if (key !== this.shellKey) {
      paintShell(this.shellCanvas, egg.id, seed, cracked);
      this.shellKey = key;
    }
  }

  private drawBackground() {
    if (this.background && this.background.width === this.w && this.background.height === this.h) {
      this.ctx.drawImage(this.background, 0, 0);
      return;
    }
    const bg = document.createElement('canvas');
    bg.width = this.w;
    bg.height = this.h;
    const c = bg.getContext('2d')!;
    const { k, cx, cy } = this.projection();
    // 木のカウンター
    const g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#ead3ad');
    g.addColorStop(1, '#d2ad7c');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
    const rnd = rngFor(7, 'planks');
    c.strokeStyle = 'rgba(150,105,60,0.18)';
    for (let i = 0; i < 26; i++) {
      c.lineWidth = 1 + rnd() * 2;
      const y = (i / 26) * this.h;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(this.w * 0.3, y + rnd() * 8, this.w * 0.7, y - rnd() * 8, this.w, y + rnd() * 6);
      c.stroke();
    }
    // 朝の光
    const light = c.createRadialGradient(this.w * 0.15, 0, 0, this.w * 0.15, 0, this.w * 0.9);
    light.addColorStop(0, 'rgba(255,248,225,0.55)');
    light.addColorStop(1, 'rgba(255,248,225,0)');
    c.fillStyle = light;
    c.fillRect(0, 0, this.w, this.h);
    // コンロの天板
    const topW = PAN_R * 2 * k * 1.55;
    const topH = PAN_R * 2 * k * SQUASH * 1.55;
    c.fillStyle = '#f3efe7';
    c.strokeStyle = 'rgba(0,0,0,0.06)';
    c.lineWidth = 2;
    roundRect(c, cx - topW / 2, cy - topH / 2 + 4 * k * SQUASH, topW, topH, 26 * this.dpr);
    c.fill();
    c.stroke();
    // 五徳
    c.strokeStyle = '#2d2e2c';
    c.lineWidth = 0.6 * k;
    c.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * 6 * k, cy + Math.sin(a) * 6 * k * SQUASH);
      c.lineTo(cx + Math.cos(a) * 13.5 * k, cy + Math.sin(a) * 13.5 * k * SQUASH);
      c.stroke();
    }
    this.background = bg;
    this.ctx.drawImage(bg, 0, 0);
  }

  private drawPan(p: ReturnType<Canvas2DRenderer['projection']>) {
    const c = this.ctx;
    const { k, cx } = p;
    const rimCy = p.sy(RIM_Y, 0);
    const floorCy = p.sy(0, 0);
    const bottomCy = p.sy(-0.45, 0);
    // 接地影
    const sh = c.createRadialGradient(cx, bottomCy + 1.2 * k, 0, cx, bottomCy + 1.2 * k, PAN_R * k * 1.15);
    sh.addColorStop(0, 'rgba(40,30,20,0.35)');
    sh.addColorStop(1, 'rgba(40,30,20,0)');
    c.fillStyle = sh;
    c.beginPath();
    c.ellipse(cx, bottomCy + 1.2 * k, PAN_R * k * 1.15, PAN_R * k * SQUASH * 1.15, 0, 0, Math.PI * 2);
    c.fill();
    // 柄（右下へ）
    c.save();
    const ha = (28 * Math.PI) / 180;
    const hx = cx + Math.cos(ha) * PAN_R * k;
    const hy = p.sy(1.8, Math.sin(ha) * PAN_R);
    c.translate(hx, hy);
    c.rotate(Math.atan2(Math.sin(ha) * SQUASH, Math.cos(ha)));
    c.fillStyle = '#2b2d2a';
    roundRect(c, -0.5 * k, -0.55 * k, 4.2 * k, 1.1 * k, 0.4 * k);
    c.fill();
    const wood = c.createLinearGradient(0, -1.1 * k, 0, 1.1 * k);
    wood.addColorStop(0, '#d9a066');
    wood.addColorStop(0.5, '#b27643');
    wood.addColorStop(1, '#7e4f28');
    c.fillStyle = wood;
    roundRect(c, 3.4 * k, -1.05 * k, 13 * k, 2.1 * k, 1.05 * k);
    c.fill();
    c.restore();
    // 外側の側面
    const outer = c.createLinearGradient(cx - PAN_R * k, 0, cx + PAN_R * k, 0);
    outer.addColorStop(0, '#2e322e');
    outer.addColorStop(0.35, '#4b504a');
    outer.addColorStop(1, '#161a18');
    c.fillStyle = outer;
    c.beginPath();
    c.ellipse(cx, bottomCy, PAN_R * k * 0.86, PAN_R * k * SQUASH * 0.86, 0, 0, Math.PI);
    c.lineTo(cx - PAN_R * k, rimCy);
    c.ellipse(cx, rimCy, PAN_R * k, PAN_R * k * SQUASH, 0, Math.PI, 0, true);
    c.closePath();
    c.fill();
    // 縁
    c.fillStyle = '#5d625b';
    c.beginPath();
    c.ellipse(cx, rimCy, PAN_R * k, PAN_R * k * SQUASH, 0, 0, Math.PI * 2);
    c.fill();
    // 内側
    const inner = c.createRadialGradient(cx, floorCy - 1.5 * k, 0, cx, floorCy, 9.3 * k);
    inner.addColorStop(0, '#454a43');
    inner.addColorStop(0.75, '#262b27');
    inner.addColorStop(1, '#141816');
    c.fillStyle = inner;
    c.beginPath();
    c.ellipse(cx, rimCy, 9.25 * k, 9.25 * k * SQUASH, 0, 0, Math.PI * 2);
    c.fill();
    // 底面と油のつや
    c.fillStyle = 'rgba(58,62,56,0.8)';
    c.beginPath();
    c.ellipse(cx, floorCy, 7.4 * k, 7.4 * k * SQUASH, 0, 0, Math.PI * 2);
    c.fill();
    const sheen = c.createRadialGradient(cx - 3 * k, floorCy - 2.5 * k * SQUASH, 0, cx - 3 * k, floorCy - 2.5 * k * SQUASH, 5 * k);
    sheen.addColorStop(0, 'rgba(255,240,210,0.16)');
    sheen.addColorStop(1, 'rgba(255,240,210,0)');
    c.fillStyle = sheen;
    c.fill();
    // 縁のハイライト
    c.strokeStyle = 'rgba(210,215,205,0.55)';
    c.lineWidth = Math.max(1, 0.18 * k);
    c.beginPath();
    c.ellipse(cx, rimCy, PAN_R * k * 0.995, PAN_R * k * SQUASH * 0.995, 0, Math.PI * 1.05, Math.PI * 1.75);
    c.stroke();
  }

  /** 油だまり（量で広さと濃さ、種類で色が変わる） */
  private drawOilPool(p: ReturnType<Canvas2DRenderer['projection']>, shape: EggShape, oil: OilId, amount: OilAmountId, alpha: number) {
    const c = this.ctx;
    const look = OIL_LOOK[oil];
    const amt = amount === 'more' ? { o: 0.42, r: 1.32 } : amount === 'less' ? { o: 0.14, r: 1.06 } : { o: 0.26, r: 1.17 };
    const r = shape.whiteRadius * amt.r * p.k;
    const cx = p.sx(0);
    const cy = p.sy(0.01, 0);
    c.save();
    c.globalAlpha = alpha;
    c.translate(cx, cy);
    c.scale(1, SQUASH);
    const g = c.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, rgbCss(look.pool, amt.o * 0.6));
    g.addColorStop(0.85, rgbCss(look.pool, amt.o));
    g.addColorStop(1, rgbCss(look.pool, 0));
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private drawEggContents(
    p: ReturnType<Canvas2DRenderer['projection']>,
    view: { shape: EggShape; W: number; Y: number; B: number; D: number; T: number; S?: number; F?: number; wet?: number; oil?: OilId; time: number; reducedMotion: boolean },
    ox: number,
    oy: number,
    oz: number,
    spread: number,
    alpha: number,
  ) {
    const c = this.ctx;
    const surface = this.ensureSurface(view.shape);
    if (view.oil) surface.setTone(view.oil);
    surface.update(view.W, view.B, view.D, false, view.wet ?? 0);
    const { k } = p;
    const ex = surface.extent * spread;
    const cx = p.sx(ox);
    const cy = p.sy(oy, oz);
    c.save();
    c.globalAlpha = alpha;
    c.translate(cx, cy);
    c.scale(1, SQUASH);
    c.drawImage(surface.canvas, -ex * k, -ex * k, ex * 2 * k, ex * 2 * k);
    c.restore();
    // 泡
    if (!view.reducedMotion && (view.T > 0.42 || (view.S ?? 0) > 0.05) && alpha > 0.9) {
      const act = Math.max(smoothstep(0.42, 0.7, view.T), (view.S ?? 0) * 1.1);
      c.save();
      for (const b of view.shape.bubbles) {
        const ph = (view.time * (0.8 + b.size) + b.phase) % 1;
        const s = Math.sin(Math.PI * ph) * act;
        if (s <= 0.05) continue;
        const rr = view.shape.whiteRadius * (0.98 + b.r * 0.12) * spread;
        const x = cx + Math.cos(b.theta) * rr * k;
        const y = cy + Math.sin(b.theta) * rr * k * SQUASH;
        c.fillStyle = 'rgba(214,168,74,0.55)';
        c.beginPath();
        c.arc(x, y, (0.12 + b.size * 0.16) * k * s, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,245,220,0.6)';
        c.beginPath();
        c.arc(x - 0.05 * k * s, y - 0.05 * k * s, 0.05 * k * s, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
    // 黄身
    const yr = view.shape.yolkRadius * Math.max(0.25, spread);
    const yx = p.sx(ox + view.shape.yolkX * spread);
    const yy = p.sy(oy + yr * 0.45, oz + view.shape.yolkZ * spread);
    c.save();
    c.globalAlpha = alpha;
    paintYolk2D(c, yx, yy, yr * k, yr * k * (SQUASH * 0.92 + 0.08), view.Y, view.F ?? 0);
    c.restore();
  }

  private drawEggWhole(p: ReturnType<Canvas2DRenderer['projection']>, egg: EggConfig, cx: number, cy: number, len: number, rot: number, clip: 'none' | 'left' | 'right', alpha: number) {
    const c = this.ctx;
    const { k } = p;
    const L = len * k;
    const R = L * 0.38;
    c.save();
    c.globalAlpha = alpha;
    c.translate(cx, cy);
    c.rotate(rot);
    if (clip !== 'none') {
      c.beginPath();
      if (clip === 'left') c.rect(-L, -L, L, 2 * L);
      else c.rect(0, -L, L, 2 * L);
      c.clip();
    }
    // 卵形（右が細い）
    const path = new Path2D();
    path.moveTo(-L / 2, 0);
    path.bezierCurveTo(-L / 2, -R * 1.35, L * 0.48, -R * 1.05, L / 2, 0);
    path.bezierCurveTo(L * 0.48, R * 1.05, -L / 2, R * 1.35, -L / 2, 0);
    const col = shellColors(egg.id);
    c.fillStyle = col.base;
    c.fill(path);
    c.save();
    c.clip(path);
    c.globalAlpha = alpha * 0.9;
    c.drawImage(this.shellCanvas, -L / 2, -R * 1.2, L, R * 2.4);
    const shade = c.createRadialGradient(-L * 0.15, -R * 0.55, R * 0.1, 0, 0, L * 0.6);
    shade.addColorStop(0, 'rgba(255,255,255,0.45)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(60,40,20,0.35)');
    c.globalAlpha = alpha;
    c.fillStyle = shade;
    c.fillRect(-L, -L, 2 * L, 2 * L);
    c.restore();
    if (clip !== 'none') {
      c.fillStyle = col.inner;
      c.beginPath();
      c.ellipse(0, 0, L * 0.05, R * 1.05, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  private drawLid(p: ReturnType<Canvas2DRenderer['projection']>, amount: number, fog: number) {
    if (amount <= 0.001) return;
    const c = this.ctx;
    const { k, cx } = p;
    const lift = (1 - amount) * 14 * k;
    const rimCy = p.sy(RIM_Y + 0.05, 0) - lift;
    const topY = p.sy(RIM_Y + 4.2, 0) - lift;
    c.save();
    c.globalAlpha = amount;
    const g = c.createLinearGradient(cx - PAN_R * k, topY, cx + PAN_R * k, rimCy);
    g.addColorStop(0, `rgba(235,245,248,${0.28 + fog * 0.2})`);
    g.addColorStop(0.5, `rgba(220,232,236,${0.12 + fog * 0.2})`);
    g.addColorStop(1, `rgba(200,215,220,${0.22 + fog * 0.2})`);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, rimCy, PAN_R * k, PAN_R * k * SQUASH, 0, 0, Math.PI);
    c.bezierCurveTo(cx - PAN_R * k, topY - 1 * k, cx + PAN_R * k, topY - 1 * k, cx + PAN_R * k, rimCy);
    c.fill();
    c.strokeStyle = 'rgba(160,170,168,0.9)';
    c.lineWidth = 0.35 * k;
    c.beginPath();
    c.ellipse(cx, rimCy, PAN_R * k, PAN_R * k * SQUASH, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 0.25 * k;
    c.beginPath();
    c.ellipse(cx - 2 * k, (topY + rimCy) / 2, PAN_R * k * 0.6, 3 * k, -0.2, Math.PI * 1.1, Math.PI * 1.45);
    c.stroke();
    c.fillStyle = '#2f302d';
    c.beginPath();
    c.ellipse(cx, topY + 0.6 * k, 1 * k, 0.6 * k, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private drawSteam(p: ReturnType<Canvas2DRenderer['projection']>, time: number, amount: number, lid: boolean, reducedMotion: boolean) {
    const c = this.ctx;
    const max = reducedMotion ? 4 : this.quality === 'high' ? 14 : 8;
    if (amount > 0.05 && time - this.lastSteamAt > (lid ? 0.9 : 0.35) / Math.max(0.2, amount) && this.steam.length < max) {
      this.lastSteamAt = time;
      const a = Math.random() * Math.PI * 2;
      const r = lid ? PAN_R : Math.random() * 4.5;
      this.steam.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.6, born: time, life: 2.2 + Math.random() * 1.2, drift: (Math.random() - 0.5) * 2, size: 2 + Math.random() * 2 });
    }
    this.steam = this.steam.filter((s) => time - s.born < s.life);
    for (const s of this.steam) {
      const t = (time - s.born) / s.life;
      const y = (lid ? RIM_Y : 0.5) + t * 12;
      const x = s.x + Math.sin(t * 3 + s.drift) * 1.2 + s.drift * t;
      const px = p.sx(x);
      const py = p.sy(y, s.z);
      const rad = (s.size + t * 4) * p.k;
      const a = Math.sin(Math.PI * t) * 0.22 * Math.min(1, amount * 1.4);
      const g = c.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(px, py, rad, 0, Math.PI * 2);
      c.fill();
    }
  }

  render(view: RenderView): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackground();
    const boost = view.egg.visualScale < 1 ? 1.12 : 1;
    const p = this.projection(boost);
    const dt = Math.max(0, view.time - this.lastTime);
    this.lastTime = view.time;
    const cook = view.cook;
    const phase = view.phase;

    // 盛り付け中は画面左へ移動しながらフェード
    let plateT = 0;
    if (phase === 'plating' || phase === 'done') plateT = phase === 'done' ? 1 : Math.min(1, (view.phaseTime * 1000) / PLATING_MS);
    this.drawPan(p);

    // 卵の中身
    const common = {
      shape: view.shape,
      W: cook.W,
      Y: cook.Y,
      B: cook.B,
      D: cook.D,
      T: cook.T,
      S: cook.S,
      F: cook.F,
      wet: cook.wet,
      oil: view.oil.id,
      time: view.time,
      reducedMotion: view.reducedMotion,
    };
    this.drawOilPool(p, view.shape, view.oil.id, view.amount.id, phase === 'plating' || phase === 'done' ? 1 : 0.95);
    const eggY = 9;
    if (phase === 'cooking' || phase === 'plating' || phase === 'done') {
      const e = easeInOut(plateT);
      this.drawEggContents(p, { ...common, T: phase === 'cooking' ? cook.T : 0 }, -e * 14, e * 5, -e * 2, 1, 1 - e);
    } else if (phase === 'drop') {
      const t = Math.min(1, (view.phaseTime * 1000) / DROP_MS);
      const fall = clamp01Local((t - 0.15) / 0.35);
      const spread = t < 0.5 ? 0.25 : 0.25 + 0.75 * easeOut(clamp01Local((t - 0.5) / 0.5));
      if (t > 0.15) this.drawEggContents(p, { ...common, W: 0, Y: 0, B: 0, D: 0, T: 0.25 }, 0, eggY * (1 - fall * fall), 0, spread, 1);
    }

    // 殻
    if (phase === 'crackReady' || phase === 'cracked' || phase === 'drop') {
      this.ensureShell(view.egg, view.shape.seed, phase !== 'crackReady');
      const len = 5.8 * view.egg.visualScale;
      const bob = view.reducedMotion ? 0 : Math.sin(view.time * 2) * 0.25;
      const baseX = p.sx(0);
      const baseY = p.sy(eggY + bob, 0);
      if (phase === 'drop') {
        const t = Math.min(1, (view.phaseTime * 1000) / DROP_MS);
        const open = easeOut(clamp01Local((t - 0.1) / 0.45));
        const fade = 1 - clamp01Local((t - 0.55) / 0.3);
        const dx = open * 2.6 * p.k;
        this.drawEggWhole(p, view.egg, baseX - dx, baseY - open * 0.8 * p.k, len, -0.18 - open * 0.7, 'left', fade);
        this.drawEggWhole(p, view.egg, baseX + dx, baseY - open * 0.8 * p.k, len, -0.18 + open * 0.7, 'right', fade);
      } else {
        const shake = phase === 'cracked' && !view.reducedMotion ? Math.sin(view.phaseTime * 60) * Math.max(0, 0.25 - view.phaseTime) * 0.4 : 0;
        // 着地位置の目印
        const ring = 0.5 + 0.5 * Math.sin(view.time * 3);
        c.save();
        c.strokeStyle = `rgba(255,255,255,${0.35 + ring * 0.3})`;
        c.lineWidth = Math.max(1.5, 0.15 * p.k);
        c.beginPath();
        c.ellipse(p.sx(0), p.sy(0.05, 0), (1.4 + ring * 0.3) * p.k, (1.4 + ring * 0.3) * p.k * SQUASH, 0, 0, Math.PI * 2);
        c.stroke();
        c.restore();
        this.drawEggWhole(p, view.egg, baseX, baseY, len, -0.18 + shake, 'none', 1);
      }
    }

    // ふた
    const lidTarget = cook.lidClosed && (phase === 'cooking' || phase === 'plating') && plateT === 0 ? 1 : 0;
    this.lidAnim = view.reducedMotion ? lidTarget : lidTarget > this.lidAnim ? Math.min(1, this.lidAnim + dt / 0.3) : Math.max(0, this.lidAnim - dt / 0.3);
    const steamAmount = phase === 'cooking' && !view.paused ? smoothstep(0.35, 0.75, cook.T) * (0.35 + 0.65 * Math.min(1, cook.W * 1.4)) + cook.S * 1.1 : 0;
    this.drawSteam(p, view.time, steamAmount, cook.lidClosed, view.reducedMotion);
    this.drawLid(p, this.lidAnim, cook.lidClosed ? Math.min(0.8, smoothstep(0.3, 1, cook.T) * 0.6 + cook.S * 0.3) : 0);
  }

  snapshotPlate(cook: FinalCook, egg: EggConfig, shape: EggShape, width: number, height: number, oil?: OilConfig): HTMLCanvasElement {
    return drawPlateSnapshot2D(cook, egg, shape, width, height, oil);
  }

  dispose(): void {
    this.surface = null;
    this.canvas.remove();
  }
}

/** 皿に盛った目玉焼き（2D）。3Dが使えない場合の結果画像にも使います。 */
export function drawPlateSnapshot2D(cook: FinalCook, _egg: EggConfig, shape: EggShape, width: number, height: number, oil?: OilConfig): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const c = out.getContext('2d')!;
  const squash = 0.8;
  // 背景：木のカウンター
  const g = c.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#ecd7b3');
  g.addColorStop(1, '#d6b183');
  c.fillStyle = g;
  c.fillRect(0, 0, width, height);
  const rnd = rngFor(3, 'planks');
  c.strokeStyle = 'rgba(150,105,60,0.14)';
  for (let i = 0; i < 18; i++) {
    c.lineWidth = 1 + rnd() * 2;
    const y = (i / 18) * height;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(width * 0.3, y + rnd() * 6, width * 0.7, y - rnd() * 6, width, y + rnd() * 5);
    c.stroke();
  }
  const light = c.createRadialGradient(width * 0.2, 0, 0, width * 0.2, 0, width);
  light.addColorStop(0, 'rgba(255,250,232,0.6)');
  light.addColorStop(1, 'rgba(255,250,232,0)');
  c.fillStyle = light;
  c.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2 + height * 0.02;
  const plateR = Math.min(width * 0.46, (height * 0.46) / squash);
  const k = plateR / 11.3;
  // 皿の影
  const sh = c.createRadialGradient(cx + 0.6 * k, cy + 1.6 * k, 0, cx + 0.6 * k, cy + 1.6 * k, plateR * 1.05);
  sh.addColorStop(0.7, 'rgba(80,55,30,0.25)');
  sh.addColorStop(1, 'rgba(80,55,30,0)');
  c.fillStyle = sh;
  c.beginPath();
  c.ellipse(cx + 0.6 * k, cy + 1.6 * k, plateR * 1.05, plateR * squash * 1.05, 0, 0, Math.PI * 2);
  c.fill();
  // 皿
  const pg = c.createRadialGradient(cx - plateR * 0.2, cy - plateR * 0.3, 0, cx, cy, plateR);
  pg.addColorStop(0, '#ffffff');
  pg.addColorStop(0.8, '#fbfaf5');
  pg.addColorStop(1, '#dfe3d8');
  c.fillStyle = pg;
  c.beginPath();
  c.ellipse(cx, cy, plateR, plateR * squash, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(200,205,195,0.9)';
  c.lineWidth = Math.max(1, 0.12 * k);
  c.beginPath();
  c.ellipse(cx, cy + 0.3 * k, 8.4 * k, 8.4 * k * squash, 0, 0, Math.PI * 2);
  c.stroke();
  // 目玉焼き
  const surface = new WhiteSurface(shape, 384);
  if (oil) surface.setTone(oil.id);
  surface.update(cook.W, cook.B, cook.D, true, cook.wet ?? 0);
  const ex = surface.extent;
  const fit = Math.min(1, 7.6 / ex);
  c.save();
  c.translate(cx, cy);
  c.scale(1, squash);
  c.drawImage(surface.canvas, -ex * k * fit, -ex * k * fit, ex * 2 * k * fit, ex * 2 * k * fit);
  c.restore();
  const yr = shape.yolkRadius * k * fit;
  paintYolk2D(c, cx + shape.yolkX * k * fit, cy + shape.yolkZ * k * fit * squash - yr * 0.35, yr, yr * (squash * 0.9 + 0.1), cook.Y, cook.F ?? 0);
  return out;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

const clamp01Local = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
