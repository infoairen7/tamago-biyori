// ランキングの表示名の正規化と検証（1〜12書記素）。
// 表示側では必ず文字列として扱い、HTMLとして解釈しません。

export const NAME_MAX_GRAPHEMES = 12;

// 制御文字、双方向テキストの上書き文字、ゼロ幅スペース類を除去（絵文字の結合用ZWJ/異体字セレクタは残す）
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F​‎‏‪-‮⁠⁦-⁩﻿]/g;

export function countGraphemes(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    let n = 0;
    for (const _ of new Seg('ja', { granularity: 'grapheme' }).segment(s)) n++;
    return n;
  }
  return Array.from(s).length;
}

export type NameResult = { ok: true; name: string } | { ok: false; error: 'empty' | 'too_long' | 'not_string' };

export function normalizeDisplayName(input: unknown): NameResult {
  if (typeof input !== 'string') return { ok: false, error: 'not_string' };
  if (input.length > 200) return { ok: false, error: 'too_long' };
  const name = input.normalize('NFC').replace(STRIP_RE, '').replace(/\s+/gu, ' ').trim();
  if (name.length === 0) return { ok: false, error: 'empty' };
  if (countGraphemes(name) > NAME_MAX_GRAPHEMES) return { ok: false, error: 'too_long' };
  return { ok: true, name };
}
