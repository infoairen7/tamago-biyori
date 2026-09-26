// キッチンの質感をcanvasで作るプロシージャルテクスチャ（外部画像なしで起動できるように）。
import * as THREE from 'three';
import { rngFor } from '../../../shared/rng.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** 明るいオーク材の天板 */
export function woodTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(512, 512);
  const rnd = rngFor(11, 'wood');
  x.fillStyle = '#d9b688';
  x.fillRect(0, 0, 512, 512);
  const plank = 512 / 4;
  for (let p = 0; p < 4; p++) {
    const y0 = p * plank;
    const tone = 0.92 + rnd() * 0.12;
    x.fillStyle = `rgba(${Math.round(222 * tone)},${Math.round(186 * tone)},${Math.round(138 * tone)},1)`;
    x.fillRect(0, y0, 512, plank);
    for (let i = 0; i < 38; i++) {
      x.strokeStyle = `rgba(150,100,55,${0.05 + rnd() * 0.12})`;
      x.lineWidth = 0.6 + rnd() * 1.8;
      const y = y0 + rnd() * plank;
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(170, y + (rnd() - 0.5) * 10, 340, y + (rnd() - 0.5) * 10, 512, y + (rnd() - 0.5) * 6);
      x.stroke();
    }
    x.fillStyle = 'rgba(120,80,45,0.35)';
    x.fillRect(0, y0, 512, 1.5);
  }
  return toTexture(c, [3, 3]);
}

/** 淡いクリーム色のタイル */
export function tileTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  x.fillStyle = '#e7dccb';
  x.fillRect(0, 0, 256, 256);
  const rnd = rngFor(5, 'tile');
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const g = x.createLinearGradient(i * 64, j * 64, i * 64 + 64, j * 64 + 64);
      const t = 0.97 + rnd() * 0.04;
      g.addColorStop(0, `rgb(${Math.round(250 * t)},${Math.round(243 * t)},${Math.round(230 * t)})`);
      g.addColorStop(1, `rgb(${Math.round(242 * t)},${Math.round(233 * t)},${Math.round(218 * t)})`);
      x.fillStyle = g;
      x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
  }
  return toTexture(c, [8, 3]);
}

/** セージの線が入った麻のふきん */
export function towelTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  x.fillStyle = '#f1ead9';
  x.fillRect(0, 0, 256, 256);
  for (const [y, h] of [
    [30, 10],
    [48, 4],
    [200, 10],
    [218, 4],
  ]) {
    x.fillStyle = '#9fb391';
    x.fillRect(0, y, 256, h);
  }
  x.globalAlpha = 0.08;
  for (let i = 0; i < 256; i += 3) {
    x.fillStyle = i % 2 ? '#000' : '#fff';
    x.fillRect(i, 0, 1, 256);
  }
  return toTexture(c);
}

/** 使い込んだ鉄のパンの底面 */
export function panFloorTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(512, 512);
  const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, '#3a3e39');
  g.addColorStop(0.7, '#2b2f2b');
  g.addColorStop(1, '#1d201e');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);
  x.globalAlpha = 0.07;
  x.strokeStyle = '#c8c1b0';
  for (let r = 8; r < 256; r += 3.2) {
    x.lineWidth = 0.6;
    x.beginPath();
    x.arc(256, 256, r, 0, Math.PI * 2);
    x.stroke();
  }
  // 油のにじみ
  x.globalAlpha = 1;
  const rnd = rngFor(3, 'oil');
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 60 + rnd() * 160;
    const og = x.createRadialGradient(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 0, 256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 20 + rnd() * 40);
    og.addColorStop(0, 'rgba(150,120,60,0.12)');
    og.addColorStop(1, 'rgba(150,120,60,0)');
    x.fillStyle = og;
    x.fillRect(0, 0, 512, 512);
  }
  return toTexture(c);
}

/** 木の柄 */
export function handleWoodTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 64);
  x.fillStyle = '#b97a45';
  x.fillRect(0, 0, 256, 64);
  const rnd = rngFor(9, 'handle');
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = `rgba(110,65,30,${0.12 + rnd() * 0.2})`;
    x.lineWidth = 0.8 + rnd() * 1.5;
    const y = rnd() * 64;
    x.beginPath();
    x.moveTo(0, y);
    x.bezierCurveTo(80, y + (rnd() - 0.5) * 8, 170, y + (rnd() - 0.5) * 8, 256, y);
    x.stroke();
  }
  return toTexture(c);
}

/** セージの帯が入った陶器（道具立て・保存瓶） */
export function crockTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  x.fillStyle = '#efe7d6';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#a9bb9b';
  x.fillRect(0, 70, 128, 34);
  x.fillStyle = 'rgba(255,255,255,0.35)';
  x.fillRect(0, 68, 128, 2);
  return toTexture(c);
}

/** 接地影（放射グラデーション） */
export function blobShadowTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(40,28,16,0.55)');
  g.addColorStop(0.55, 'rgba(40,28,16,0.28)');
  g.addColorStop(1, 'rgba(40,28,16,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 湯気のやわらかい粒 */
export function steamTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 朝のキッチンを想定した環境マップ（反射用、正距円筒） */
export function environmentCanvas(): HTMLCanvasElement {
  const [c, x] = canvas(512, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(0.42, '#f6ead6');
  g.addColorStop(0.5, '#e9d7bb');
  g.addColorStop(0.62, '#c9a57a');
  g.addColorStop(1, '#8e6a45');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 256);
  // 左上の窓の明かり（黄身とパンのハイライト用）
  const wg = x.createRadialGradient(150, 60, 0, 150, 60, 70);
  wg.addColorStop(0, 'rgba(255,255,255,1)');
  wg.addColorStop(0.5, 'rgba(255,250,235,0.85)');
  wg.addColorStop(1, 'rgba(255,250,235,0)');
  x.fillStyle = wg;
  x.fillRect(60, 0, 190, 140);
  x.fillStyle = 'rgba(255,255,255,0.95)';
  x.fillRect(118, 30, 26, 44);
  x.fillRect(150, 30, 26, 44);
  // 緑の植物
  x.fillStyle = 'rgba(120,160,100,0.35)';
  for (let i = 0; i < 12; i++) {
    x.beginPath();
    x.arc(60 + i * 9, 100 + Math.sin(i) * 8, 8, 0, Math.PI * 2);
    x.fill();
  }
  return c;
}
