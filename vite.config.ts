import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE: GitHub Pages などサブパスで公開する場合に指定（例: /tamago-biyori/）
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    // 開発中は同じオリジンの /api をランキングサーバー（npm run server）へ中継
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
