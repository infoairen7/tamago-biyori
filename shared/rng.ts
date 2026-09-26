// run seedから決まる乱数。見た目（白身の輪郭・泡の位置など）だけに使い、点数には影響しません。

/** mulberry32: 32bit seedの高速な擬似乱数 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seedと用途名から独立した乱数列を作ります。 */
export function rngFor(seed: number, purpose: string): () => number {
  let h = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < purpose.length; i++) {
    h ^= purpose.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

export function randomSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
