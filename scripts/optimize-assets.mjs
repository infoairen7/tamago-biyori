// 元PNG（assets/original）から配信用のWebP/PNGを public/assets に書き出します。
// 元画像は変更しません。実行: npm i -D sharp && node scripts/optimize-assets.mjs
import { mkdir } from 'node:fs/promises';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp が見つかりません。`npm i -D sharp` を実行してから再度お試しください。');
  process.exit(1);
}

const SRC = 'assets/original';
const OUT = 'public/assets';
await mkdir(OUT, { recursive: true });

// タイトル用メインビジュアル（不透明）
for (const [width, suffix, quality] of [[1536, '', 80], [900, '-900', 78]]) {
  await sharp(`${SRC}/hero.png`).resize({ width }).webp({ quality }).toFile(`${OUT}/hero${suffix}.webp`);
}
// 卵カード用（透過）: 余白を詰めて縦320pxに
for (const id of ['egg_white', 'egg_brown', 'egg_quail']) {
  const trimmed = await sharp(`${SRC}/${id}.png`).trim({ threshold: 1 }).toBuffer();
  await sharp(trimmed).resize({ height: 320 }).webp({ quality: 82, alphaQuality: 90 }).toFile(`${OUT}/${id}.webp`);
}
console.log('done');
