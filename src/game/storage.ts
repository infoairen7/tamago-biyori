// 端末内の保存（設定・自己ベスト・匿名セッション）。localStorageが使えない場合はメモリ内だけで保持します。
import { GAME_CONFIG, type EggId, type TargetId } from '../../shared/config.ts';

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
}

export const DEFAULT_SETTINGS: Settings = { volume: 0.5, muted: false, quality: 'auto', renderMode: 'auto', motion: 'system', hints: true };

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

const bestKey = (egg: EggId, target: TargetId) => `${GAME_CONFIG.scoringVersion}:${egg}:${target}`;

export function getLocalBest(egg: EggId, target: TargetId): LocalBest | null {
  const all = store.get<Record<string, LocalBest>>('best', {});
  return all[bestKey(egg, target)] ?? null;
}

/** 端末内の自己ベストを更新します。更新した場合 true。 */
export function recordLocalBest(egg: EggId, target: TargetId, score: number, at: number): { isNewBest: boolean; previous: LocalBest | null } {
  const all = store.get<Record<string, LocalBest>>('best', {});
  const key = bestKey(egg, target);
  const previous = all[key] ?? null;
  const isNewBest = !previous || score > previous.score;
  if (isNewBest) {
    all[key] = { score, at };
    store.set('best', all);
  }
  return { isNewBest, previous };
}

export function clearLocalRecords(): void {
  store.remove('best');
  store.remove('tutorialSeen');
}

export function getLastSelection(): { eggId: EggId; targetId: TargetId } {
  return store.get('selection', { eggId: 'white' as EggId, targetId: 'soft' as TargetId });
}

export function saveLastSelection(eggId: EggId, targetId: TargetId): void {
  store.set('selection', { eggId, targetId });
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
