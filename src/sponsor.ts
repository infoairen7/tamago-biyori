// 協賛企業の設定。public/config/sponsor.json（sponsor-config.example.json と同じ形）を実行時に読みます。
// 未設定・無効・必須項目の欠落・キャンペーン期間外のときは、PR枠を表示しません。
// 商品の特徴・受賞歴・効能・購入先をコード側で創作しないでください。

export interface SponsorConfig {
  enabled: boolean;
  companyName: string;
  logoUrl: string;
  disclosure: string;
  headline: string;
  description: string;
  product: {
    id: string;
    name: string;
    imageUrl: string;
    approvedDescription: string;
    destinationUrl: string;
  };
  campaign: { id: string; startAt: string | null; endAt: string | null };
  ctaLabel: string;
  shareHashtag: string;
  publicGameUrl: string;
  privacyUrl: string;
  termsUrl: string;
}

export interface Sponsor {
  companyName: string;
  disclosure: string;
  headline: string;
  description: string;
  logoUrl: string | null;
  product: { name: string; imageUrl: string | null; description: string; url: string } | null;
  ctaLabel: string;
  campaignId: string;
}

export interface PublicSettings {
  shareHashtag: string;
  publicGameUrl: string;
  privacyUrl: string;
  termsUrl: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function safeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s, typeof window !== 'undefined' ? window.location.href : 'https://localhost/');
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseSponsor(raw: unknown, now = Date.now()): { sponsor: Sponsor | null; settings: PublicSettings } {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<SponsorConfig>;
  const settings: PublicSettings = {
    shareHashtag: str(c.shareHashtag) || 'たまご日和',
    publicGameUrl: safeUrl(c.publicGameUrl) ?? '',
    privacyUrl: safeUrl(c.privacyUrl) ?? '',
    termsUrl: safeUrl(c.termsUrl) ?? '',
  };
  if (c.enabled !== true || !str(c.companyName)) return { sponsor: null, settings };
  const start = c.campaign?.startAt ? Date.parse(c.campaign.startAt) : NaN;
  const end = c.campaign?.endAt ? Date.parse(c.campaign.endAt) : NaN;
  if ((!Number.isNaN(start) && now < start) || (!Number.isNaN(end) && now >= end)) return { sponsor: null, settings };
  const p = c.product;
  const productUrl = safeUrl(p?.destinationUrl);
  const product = p && str(p.name) && productUrl ? { name: str(p.name), imageUrl: safeUrl(p.imageUrl), description: str(p.approvedDescription), url: productUrl } : null;
  return {
    sponsor: {
      companyName: str(c.companyName),
      disclosure: str(c.disclosure) || 'PR・提供',
      headline: str(c.headline) || '今度は、本物のたまごで。',
      description: str(c.description),
      logoUrl: safeUrl(c.logoUrl),
      product,
      ctaLabel: str(c.ctaLabel) || 'この卵を見てみる',
      campaignId: str(c.campaign?.id),
    },
    settings,
  };
}

export async function loadSponsor(): Promise<{ sponsor: Sponsor | null; settings: PublicSettings }> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config/sponsor.json`, { cache: 'no-cache' });
    if (!res.ok) return parseSponsor(null);
    return parseSponsor(await res.json());
  } catch {
    return parseSponsor(null);
  }
}
