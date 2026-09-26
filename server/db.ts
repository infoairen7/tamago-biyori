// SQLite（Node.js標準の node:sqlite）によるランキングの永続化。
// 日時は全てUTCのエポックミリ秒で保存します。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  session_credential_hash TEXT NOT NULL UNIQUE,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  egg_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edge_id TEXT NOT NULL DEFAULT 'golden',
  oil_id TEXT NOT NULL DEFAULT 'salad',
  oil_amount_id TEXT NOT NULL DEFAULT 'normal',
  seed INTEGER NOT NULL,
  scoring_version TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued', 'finished')),
  log_hash TEXT
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  egg_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edge_id TEXT NOT NULL DEFAULT 'golden',
  oil_id TEXT NOT NULL DEFAULT 'salad',
  oil_amount_id TEXT NOT NULL DEFAULT 'normal',
  water_step INTEGER,
  wet REAL NOT NULL DEFAULT 0,
  scoring_version TEXT NOT NULL,
  w REAL NOT NULL,
  y REAL NOT NULL,
  b REAL NOT NULL,
  d REAL NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  stop_step INTEGER NOT NULL CHECK (stop_step BETWEEN 0 AND 5400),
  verified_at INTEGER NOT NULL,
  week_start INTEGER NOT NULL,
  published_at INTEGER,
  display_name TEXT,
  hidden_at INTEGER
);

-- 操作ログ：検証に必要な期間だけ保持（EVENTS_RETENTION_DAYS）
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  step INTEGER NOT NULL,
  action TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
`;

/** 列を追加した後に作る索引 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS runs_player ON runs(player_id);
CREATE INDEX IF NOT EXISTS runs_status_started ON runs(status, started_at);
CREATE INDEX IF NOT EXISTS results_board2 ON results(scoring_version, egg_id, target_id, edge_id, week_start, published_at);
CREATE INDEX IF NOT EXISTS results_player ON results(player_id);
CREATE INDEX IF NOT EXISTS events_created ON events(created_at);
`;

/** 採点バージョン2.0.0で追加した列（古いデータベースに不足していれば追加） */
const ADDED_COLUMNS: [table: string, column: string, ddl: string][] = [
  ['runs', 'edge_id', "TEXT NOT NULL DEFAULT 'golden'"],
  ['runs', 'oil_id', "TEXT NOT NULL DEFAULT 'salad'"],
  ['runs', 'oil_amount_id', "TEXT NOT NULL DEFAULT 'normal'"],
  ['results', 'edge_id', "TEXT NOT NULL DEFAULT 'golden'"],
  ['results', 'oil_id', "TEXT NOT NULL DEFAULT 'salad'"],
  ['results', 'oil_amount_id', "TEXT NOT NULL DEFAULT 'normal'"],
  ['results', 'water_step', 'INTEGER'],
  ['results', 'wet', 'REAL NOT NULL DEFAULT 0'],
];

function migrate(db: DatabaseSync): void {
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  migrate(db);
  db.exec(INDEXES);
  return db;
}

/** トランザクション内で関数を実行します（失敗時はロールバック）。 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 保持期間を過ぎた操作ログと、完了しなかった古いrunを削除します。 */
export function cleanup(db: DatabaseSync, now: number, eventsRetentionDays: number): { events: number; runs: number } {
  const eventsCutoff = now - eventsRetentionDays * 24 * 60 * 60 * 1000;
  const ev = db.prepare('DELETE FROM events WHERE created_at < ?').run(eventsCutoff);
  const runsCutoff = now - 24 * 60 * 60 * 1000;
  const rn = db
    .prepare("DELETE FROM runs WHERE status = 'issued' AND expires_at < ? AND id NOT IN (SELECT run_id FROM results)")
    .run(runsCutoff);
  return { events: Number(ev.changes), runs: Number(rn.changes) };
}
