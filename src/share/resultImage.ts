// 結果画像（1200×630 PNG）。そのプレイの確定状態から描いた皿の画像を左に大きく置き、右に点数など。
// 画面のボタンや入力欄は含めません。UIのスクリーンショットは使いません。
import tokens from '../../config/design-tokens.json' with { type: 'json' };

export interface ResultImageInput {
  plate: HTMLCanvasElement;
  score: number;
  title: string;
  eggName: string;
  targetLabel: string;
  parts: { white: number; yolk: number; brown: number };
  /** オンラインで検証済みの場合のみ（順位と取得時刻） */
  rankLine?: string | null;
  sponsor?: { disclosure: string; companyName: string; logoUrl: string | null } | null;
}

export interface ResultImage {
  blob: Blob;
  url: string;
  file: File;
  width: number;
  height: number;
}

const C = tokens.colors;
const FONT = tokens.fontFamily;

function loadImage(src: string, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawEggMark(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.save();
  c.translate(x, y);
  c.rotate(-0.2);
  c.fillStyle = '#ffffff';
  c.shadowColor = 'rgba(36,76,58,0.12)';
  c.shadowBlur = 8 * s;
  c.beginPath();
  c.ellipse(0, 0, 30 * s, 24 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = C.yolk;
  c.beginPath();
  c.arc(0, 0, 13 * s, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e49611';
  c.beginPath();
  c.arc(3 * s, 4 * s, 13 * s, 0.1, Math.PI * 0.9);
  c.fill();
  c.restore();
}

/** 1200×630（低メモリ端末では600×315）のPNGを作ります。 */
export async function buildResultImage(input: ResultImageInput, lowMemory = false): Promise<ResultImage> {
  try {
    await document.fonts?.ready;
  } catch {
    /* noop */
  }
  const scale = lowMemory ? 0.5 : 1;
  const W = Math.round(1200 * scale);
  const H = Math.round(630 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('canvas unavailable');
  c.scale(scale, scale);

  // 背景
  c.fillStyle = C.background;
  c.fillRect(0, 0, 1200, 630);
  const glow = c.createRadialGradient(120, 0, 0, 120, 0, 900);
  glow.addColorStop(0, 'rgba(255,236,190,0.55)');
  glow.addColorStop(1, 'rgba(255,236,190,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, 1200, 630);

  // 左：そのプレイの目玉焼き（約65%）
  const px = 48;
  const py = 48;
  const pw = 700;
  const ph = 534;
  c.save();
  roundRectPath(c, px, py, pw, ph, 28);
  c.clip();
  const src = input.plate;
  const sAspect = src.width / src.height;
  const dAspect = pw / ph;
  let sx = 0;
  let sy = 0;
  let sw = src.width;
  let sh = src.height;
  if (sAspect > dAspect) {
    sw = src.height * dAspect;
    sx = (src.width - sw) / 2;
  } else {
    sh = src.width / dAspect;
    sy = (src.height - sh) / 2;
  }
  c.drawImage(src, sx, sy, sw, sh, px, py, pw, ph);
  c.restore();

  // 右：点数・称号・条件
  const rx = 796;
  c.fillStyle = '#58725c';
  c.font = `700 17px ${FONT}`;
  c.textBaseline = 'alphabetic';
  if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '3px';
  c.fillText('YOUR SUNNY-SIDE UP', rx, 104);
  if ('letterSpacing' in c) (c as unknown as { letterSpacing: string }).letterSpacing = '0px';
  c.fillStyle = C.text;
  c.font = `700 38px ${FONT}`;
  c.fillText(input.title, rx, 162, 360);
  c.font = `800 168px ${FONT}`;
  const scoreText = String(input.score);
  c.fillText(scoreText, rx - 6, 330);
  const sw2 = c.measureText(scoreText).width;
  c.font = `700 40px ${FONT}`;
  c.fillText('点', rx - 6 + sw2 + 8, 330);

  // 条件のタグ
  const tag = `${input.eggName} × ${input.targetLabel}`;
  let tagSize = 24;
  c.font = `700 ${tagSize}px ${FONT}`;
  while (c.measureText(tag).width > 318 && tagSize > 16) {
    tagSize -= 1;
    c.font = `700 ${tagSize}px ${FONT}`;
  }
  const tw = c.measureText(tag).width;
  c.fillStyle = C.accentSoft;
  roundRectPath(c, rx, 364, tw + 36, 48, 24);
  c.fill();
  c.fillStyle = C.primary;
  c.fillText(tag, rx + 18, 388 + tagSize / 3);

  // 3項目
  c.fillStyle = C.muted;
  c.font = `500 20px ${FONT}`;
  c.fillText(`白身 ${input.parts.white}/40 ・ 黄身 ${input.parts.yolk}/40 ・ 焼き目 ${input.parts.brown}/20`, rx, 452, 360);
  if (input.rankLine) {
    c.fillStyle = C.primary;
    c.font = `700 20px ${FONT}`;
    c.fillText(input.rankLine, rx, 486, 360);
  }

  // 下：ゲーム名と任意の提供ロゴ
  drawEggMark(c, rx + 26, 540, 0.95);
  c.fillStyle = C.text;
  c.font = `800 30px ${FONT}`;
  c.fillText('たまご日和', rx + 66, 540);
  c.fillStyle = C.muted;
  c.font = `500 16px ${FONT}`;
  c.fillText('じゅわっ、とろっ。今日のひと皿。', rx + 66, 566);
  if (input.sponsor) {
    c.fillStyle = C.muted;
    c.font = `500 13px ${FONT}`;
    const label = `${input.sponsor.disclosure}：${input.sponsor.companyName}`;
    c.fillText(label, rx, 604, 356);
    if (input.sponsor.logoUrl) {
      const logo = await loadImage(input.sponsor.logoUrl);
      if (logo) {
        const h = 26;
        const w = Math.min(120, (logo.naturalWidth / Math.max(1, logo.naturalHeight)) * h);
        try {
          c.drawImage(logo, 1152 - w, 586, w, h);
        } catch {
          /* 読み込めないロゴは省略 */
        }
      }
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else {
          try {
            const data = canvas.toDataURL('image/png');
            fetch(data)
              .then((r) => r.blob())
              .then(resolve, reject);
          } catch (e) {
            reject(e);
          }
        }
      }, 'image/png');
    } catch (e) {
      reject(e);
    }
  });
  const name = `tamago-biyori-${input.score}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  return { blob, file, url: URL.createObjectURL(blob), width: W, height: H };
}

export function isLowMemoryDevice(): boolean {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof mem === 'number' && mem <= 2;
}

/** 画像ファイル共有に対応しているか（HTTPS・share/canShare・ファイル対応） */
export function canShareFile(file: File): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return window.isSecureContext && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** a[download]で保存します。成功したかは判定できないため、呼び出し側で保存方法の案内も出します。 */
export function triggerDownload(url: string, filename: string): boolean {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    if (!('download' in a)) return false;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}
