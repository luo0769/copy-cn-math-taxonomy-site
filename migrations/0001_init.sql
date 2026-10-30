-- D1 数据库初始化（Cloudflare Pages Functions 绑定名 DB）
-- 执行：wrangler d1 migrations apply cn-math-taxonomy-db --remote
--   或：wrangler d1 execute cn-math-taxonomy-db --remote --file=./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT,                     -- NULL = 空密码（仅凭用户名登录）
  role          TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS site_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_data_user ON user_data(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
