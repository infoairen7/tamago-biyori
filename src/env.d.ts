// Viteが注入する環境変数の型（vite/client に依存しない最小限の宣言）
interface ImportMetaEnv {
  /** ランキングAPIの接続先。未設定なら未接続（ローカルのみ）。同一オリジンなら "/" */
  readonly VITE_API_BASE?: string;
  /** Xの投稿に付ける公開ゲームURL。未設定なら付けない */
  readonly VITE_PUBLIC_GAME_URL?: string;
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css';
