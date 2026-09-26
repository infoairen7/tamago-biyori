import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyText, buildHashtags, buildShareText, buildXIntentUrl } from '../src/share/shareText.ts';
import { parseSponsor } from '../src/sponsor.ts';
import example from '../config/sponsor-config.example.json' with { type: 'json' };

test('Xの投稿URLはURLSearchParamsで正しくエンコードされ、未公開ならurlを付けない', () => {
  const text = buildShareText({ score: 96, eggName: '白い卵', targetLabel: 'とろり', title: '理想のひと皿！' });
  assert.equal(text, '目玉焼き、今日は96点！\n白い卵 × とろりで「理想のひと皿！」\nあなたは何点？');
  const tags = buildHashtags('#たまご日和');
  assert.deepEqual(tags, ['たまご日和', '目玉焼きチャレンジ']);
  const u = new URL(buildXIntentUrl(text, '', tags));
  assert.equal(u.origin + u.pathname, 'https://x.com/intent/tweet');
  assert.equal(u.searchParams.get('text'), text);
  assert.equal(u.searchParams.get('hashtags'), 'たまご日和,目玉焼きチャレンジ');
  assert.equal(u.searchParams.has('url'), false);
  const withUrl = new URL(buildXIntentUrl(text, 'https://example.com/game?a=1&b=2', tags));
  assert.equal(withUrl.searchParams.get('url'), 'https://example.com/game?a=1&b=2');
  assert.equal(buildCopyText(text, '', tags), `${text}\n#たまご日和 #目玉焼きチャレンジ`);
});

test('協賛設定：初期値（enabled:false）や必須項目の欠落ではPR枠を出さない', () => {
  assert.equal(parseSponsor(example).sponsor, null);
  assert.equal(parseSponsor(null).sponsor, null);
  assert.equal(parseSponsor({ ...example, enabled: true }).sponsor, null); // 社名なし
  const ok = parseSponsor({
    ...example,
    enabled: true,
    companyName: 'テスト社',
    product: { ...example.product, name: '商品', destinationUrl: 'https://example.com/p' },
  }).sponsor;
  assert.ok(ok);
  assert.equal(ok?.product?.url, 'https://example.com/p');
  // 購入先URLが無い商品はカードを出さない
  const noUrl = parseSponsor({ ...example, enabled: true, companyName: 'テスト社', product: { ...example.product, name: '商品' } }).sponsor;
  assert.equal(noUrl?.product, null);
  // javascript: などのURLは使わない
  const bad = parseSponsor({ ...example, enabled: true, companyName: 'テスト社', logoUrl: 'javascript:alert(1)', product: { ...example.product, name: '商品', destinationUrl: 'javascript:alert(1)' } }).sponsor;
  assert.equal(bad?.logoUrl, null);
  assert.equal(bad?.product, null);
});

test('協賛設定：キャンペーン期間外は表示しない', () => {
  const base = { ...example, enabled: true, companyName: 'テスト社' };
  const now = Date.parse('2026-09-27T00:00:00Z');
  assert.equal(parseSponsor({ ...base, campaign: { id: 'c', startAt: '2026-10-01T00:00:00+09:00', endAt: null } }, now).sponsor, null);
  assert.equal(parseSponsor({ ...base, campaign: { id: 'c', startAt: null, endAt: '2026-09-01T00:00:00+09:00' } }, now).sponsor, null);
  assert.ok(parseSponsor({ ...base, campaign: { id: 'c', startAt: '2026-09-01T00:00:00+09:00', endAt: '2026-10-01T00:00:00+09:00' } }, now).sponsor);
});
