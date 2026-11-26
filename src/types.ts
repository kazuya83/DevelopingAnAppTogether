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
  /** iOS アプリの通知（APNs）。鍵（.p8 の中身）は `wrangler secret put APNS_KEY` で入れる */
  APNS_KEY?: string;
  /** APNs の鍵の ID（Apple Developer の Keys に出る 10 文字） */
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** 通知の宛先のアプリ（バンドル ID） */
  APNS_TOPIC?: string;
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
