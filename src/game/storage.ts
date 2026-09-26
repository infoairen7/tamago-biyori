// 端末内の保存（設定・自己ベスト・匿名セッション）。localStorageが使えない場合はメモリ内だけで保持します。
import {
  DEFAULT_EDGE,
  DEFAULT_OIL,
  DEFAULT_OIL_AMOUNT,
  GAME_CONFIG,
  isEdgeId,
  isEggId,
  isOilAmountId,
  isOilId,
  isTargetId,
  type EdgeId,
  type EggId,
  type Recipe,
  type TargetId,
} from '../../shared/config.ts';

const PREFIX = 'tamago-biyori:v1:';

class SafeStore {
  readonly persistent: boolean;
  private memory = new Map<string, string>();

  constructor() {
    let ok = false;
    try {
      const k = `${PREFIX}__probe`;
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      ok = true;
    } catch {
      ok = false;
    }
    this.persistent = ok;
  }

  get<T>(key: string, fallback: T): T {
    const k = PREFIX + key;
    let raw: string | null | undefined;
    try {
      raw = this.persistent ? window.localStorage.getItem(k) : this.memory.get(k);
    } catch {
      raw = this.memory.get(k);
    }
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    const k = PREFIX + key;
    const raw = JSON.stringify(value);
    this.memory.set(k, raw);
    if (!this.persistent) return;
    try {
      window.localStorage.setItem(k, raw);
    } catch {
      // 容量超過などは無視（メモリ上には残る）
    }
  }

  remove(key: string): void {
    const k = PREFIX + key;
    this.memory.delete(k);
    if (!this.persistent) return;
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  }
}

export const store = new SafeStore();

export type QualitySetting = 'auto' | 'high' | 'low';
export type RenderSetting = 'auto' | '3d' | '2d';
export type MotionSetting = 'system' | 'reduce' | 'full';

export interface Settings {
  volume: number;
  muted: boolean;
  quality: QualitySetting;
  renderMode: RenderSetting;
  motion: MotionSetting;
  hints: boolean;
  /** 段階的な解放を待たずに、こだわりの選択肢をすべて使う */
  unlockAll: boolean;
}

export const DEFAULT_SETTINGS: Settings = { volume: 0.5, muted: false, quality: 'auto', renderMode: 'auto', motion: 'system', hints: true, unlockAll: false };

export function loadSettings(): Settings {
  const s = store.get<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...s, volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : DEFAULT_SETTINGS.volume };
}

export function saveSettings(s: Settings): void {
  store.set('settings', s);
}

export interface LocalBest {
  score: number;
  at: number;
}

const bestKey = (r: Pick<Recipe, 'eggId' | 'targetId' | 'edgeId'>) => `${GAME_CONFIG.scoringVersion}:${r.eggId}:${r.targetId}:${r.edgeId}`;

export function getLocalBest(r: Pick<Recipe, 'eggId' | 'targetId' | 'edgeId'>): LocalBest | null {
  const all = store.get<Record<string, LocalBest>>('best', {});
  return all[bestKey(r)] ?? null;
}

/** 卵ごとの「レシピ帳」：黄身×縁の9通りの自己ベスト */
export function getRecipeBook(eggId: EggId): Record<`${TargetId}:${EdgeId}`, LocalBest | undefined> {
  const all = store.get<Record<string, LocalBest>>('best', {});
  const out: Record<string, LocalBest | undefined> = {};
  for (const t of GAME_CONFIG.targets) for (const e of GAME_CONFIG.edgeTargets) out[`${t.id}:${e.id}`] = all[bestKey({ eggId, targetId: t.id, edgeId: e.id })];
  return out as Record<`${TargetId}:${EdgeId}`, LocalBest | undefined>;
}

/** 端末内の自己ベストを更新します。更新した場合 true。 */
export function recordLocalBest(r: Pick<Recipe, 'eggId' | 'targetId' | 'edgeId'>, score: number, at: number): { isNewBest: boolean; previous: LocalBest | null } {
  const all = store.get<Record<string, LocalBest>>('best', {});
  const key = bestKey(r);
  const previous = all[key] ?? null;
  const isNewBest = !previous || score > previous.score;
  if (isNewBest) {
    all[key] = { score, at };
    store.set('best', all);
  }
  return { isNewBest, previous };
}

// ---- こだわりの段階的な解放 ----

export type Feature = 'edge' | 'oilAmount' | 'water' | 'oilType';

/** 何皿焼いたら使えるようになるか */
export const FEATURE_UNLOCK_AT: Record<Feature, number> = { edge: 1, oilAmount: 1, water: 2, oilType: 3 };

export interface Unlocks {
  edge: boolean;
  oilAmount: boolean;
  water: boolean;
  oilType: boolean;
}

export function getPlays(): number {
  const n = store.get<number>('plays', 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function unlocksFor(plays: number, unlockAll: boolean): Unlocks {
  const u = (f: Feature) => unlockAll || plays >= FEATURE_UNLOCK_AT[f];
  return { edge: u('edge'), oilAmount: u('oilAmount'), water: u('water'), oilType: u('oilType') };
}

/** 1皿焼き終えたことを記録し、この1皿で新しく使えるようになったこだわりを返します */
export function recordPlay(unlockAll: boolean): { plays: number; newlyUnlocked: Feature[] } {
  const before = getPlays();
  const plays = before + 1;
  store.set('plays', plays);
  if (unlockAll) return { plays, newlyUnlocked: [] };
  const newlyUnlocked = (Object.keys(FEATURE_UNLOCK_AT) as Feature[]).filter((f) => FEATURE_UNLOCK_AT[f] === plays);
  return { plays, newlyUnlocked };
}

/** まだ使えないこだわりは基本の値にそろえます */
export function applyUnlocks(r: Recipe, u: Unlocks): Recipe {
  return {
    eggId: r.eggId,
    targetId: r.targetId,
    edgeId: u.edge ? r.edgeId : DEFAULT_EDGE,
    oilAmountId: u.oilAmount ? r.oilAmountId : DEFAULT_OIL_AMOUNT,
    oilId: u.oilType ? r.oilId : DEFAULT_OIL,
  };
}

export function clearLocalRecords(): void {
  store.remove('best');
  store.remove('tutorialSeen');
  store.remove('plays');
  store.remove('selection');
}

const DEFAULT_RECIPE: Recipe = { eggId: 'white', targetId: 'soft', edgeId: DEFAULT_EDGE, oilId: DEFAULT_OIL, oilAmountId: DEFAULT_OIL_AMOUNT };

export function getLastSelection(): Recipe {
  const s = store.get<Partial<Recipe>>('selection', {});
  return {
    eggId: isEggId(s.eggId) ? s.eggId : DEFAULT_RECIPE.eggId,
    targetId: isTargetId(s.targetId) ? s.targetId : DEFAULT_RECIPE.targetId,
    edgeId: isEdgeId(s.edgeId) ? s.edgeId : DEFAULT_RECIPE.edgeId,
    oilId: isOilId(s.oilId) ? s.oilId : DEFAULT_RECIPE.oilId,
    oilAmountId: isOilAmountId(s.oilAmountId) ? s.oilAmountId : DEFAULT_RECIPE.oilAmountId,
  };
}

export function saveLastSelection(r: Recipe): void {
  store.set('selection', r);
}

export function isTutorialSeen(): boolean {
  return store.get('tutorialSeen', false);
}

export function markTutorialSeen(): void {
  store.set('tutorialSeen', true);
}

export function getDisplayName(): string {
  return store.get('displayName', '');
}

export function saveDisplayName(name: string): void {
  store.set('displayName', name);
}

export function getPlayerToken(): string | null {
  return store.get<string | null>('playerToken', null);
}

export function savePlayerToken(token: string | null): void {
  if (token) store.set('playerToken', token);
  else store.remove('playerToken');
}
