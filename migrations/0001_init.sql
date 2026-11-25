-- ユーザ
CREATE TABLE users (
  id TEXT PRIMARY KEY,                       -- パスキーの user.id と同じ（base64url）
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  avatar TEXT,                               -- 128px の JPEG を base64 で保存（R2 を使わず無料枠で済ませる）
  avatar_updated_at INTEGER,
  created_at INTEGER NOT NULL
);

-- パスキー
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,                       -- credential ID（base64url）
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,                  -- base64url
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                           -- JSON 配列
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

-- ログイン中のセッション（トークンは SHA-256 で保存）
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- パスキー登録・ログイン中のチャレンジ
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                        -- register / login / add
  challenge TEXT NOT NULL,
  user_id TEXT,
  username TEXT,
  expires_at INTEGER NOT NULL
);

-- 提案（議論）
CREATE TABLE proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',       -- open / creating / issued
  issue_number INTEGER,
  issue_url TEXT,
  issued_at INTEGER,
  status_updated_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_proposals_user ON proposals(user_id);
CREATE INDEX idx_proposals_created ON proposals(created_at);

CREATE TABLE likes (
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);
CREATE INDEX idx_likes_user ON likes(user_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_comments_proposal ON comments(proposal_id);
CREATE INDEX idx_comments_user ON comments(user_id);

-- 通報とブロック（App Store のガイドライン 1.2 対応）
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,                 -- proposal / comment / user
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
