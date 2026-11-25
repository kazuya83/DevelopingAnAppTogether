export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LIKE_THRESHOLD: string;
  GITHUB_REPO: string;
  GITHUB_ISSUE_LABEL: string;
  ADMIN_USERNAMES: string;
  APPLE_APP_ID: string;
  RP_NAME: string;
  /** `wrangler secret put GITHUB_TOKEN` で入れる（Issues: Read and write の fine-grained token） */
  GITHUB_TOKEN?: string;
  /** 入れておくと、Issue 本文のリンク先とパスキーの RP ID をこのドメインに固定する（例: https://example.com） */
  PUBLIC_ORIGIN?: string;
  /** テスト用。GitHub API の代わりに使う URL */
  GITHUB_API_BASE?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  avatar_updated_at: number | null;
  created_at: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser | null };
};
