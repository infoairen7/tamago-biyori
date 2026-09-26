// 本番用：ビルド済みの dist をランキングサーバーから同じオリジンで配信します。
// 先に `VITE_API_BASE=/ npm run build` でビルドしてください。
process.env.STATIC_DIR ||= 'dist';
await import('../server/index.ts');
