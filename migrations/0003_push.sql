-- iOS アプリの通知（APNs）の宛先。1 台の端末に 1 行。ログインしたユーザに結び付ける
CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY,                    -- APNs のデバイストークン（16 進）
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  env TEXT NOT NULL,                         -- sandbox（開発用ビルド）/ production（App Store・TestFlight）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
