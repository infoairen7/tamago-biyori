// ランキングサーバーの起動。Node.js 22.18以上で `node server/index.ts` として直接実行できます。
// 環境変数は .env.example を参照してください。
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createApp } from './app.ts';

// .env があれば読み込む（既に設定済みの環境変数は上書きしない）
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '0.0.0.0';

const app = createApp({
  dbPath: env.DB_PATH ?? 'data/tamago.sqlite',
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(','),
  staticDir: env.STATIC_DIR || undefined,
  adminToken: env.ADMIN_TOKEN || undefined,
  runTtlMs: env.RUN_TTL_MINUTES ? Number(env.RUN_TTL_MINUTES) * 60_000 : undefined,
  elapsedToleranceMs: env.ELAPSED_TOLERANCE_MS ? Number(env.ELAPSED_TOLERANCE_MS) : undefined,
  eventsRetentionDays: env.EVENTS_RETENTION_DAYS ? Number(env.EVENTS_RETENTION_DAYS) : undefined,
  trustProxy: env.TRUST_PROXY === '1',
});

const server = createServer((req, res) => {
  void app.handle(req, res);
});
server.listen(port, host, () => {
  console.log(`[tamago-biyori] ranking server listening on http://${host}:${port}${env.STATIC_DIR ? ` (static: ${env.STATIC_DIR})` : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      app.close();
      process.exit(0);
    });
  });
}
