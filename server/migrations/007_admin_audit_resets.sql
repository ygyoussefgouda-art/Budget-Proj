-- Admin page, audit log and owner-issued password reset codes.

-- When each account was last used (updated at most about once an hour).
ALTER TABLE users ADD COLUMN last_active_at TIMESTAMPTZ;

-- Settings an admin can change while the app runs (they override the .env defaults).
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY CHECK (key IN ('allow_signup', 'invite_code')),
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every admin action (and password resets) is written here. Kept when the people involved are deleted.
CREATE TABLE audit_log (
  id             BIGSERIAL PRIMARY KEY,
  actor_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT NOT NULL,
  action         TEXT NOT NULL,
  target         TEXT,
  details        JSONB NOT NULL DEFAULT '{}',
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);

-- One-time reset codes: only a hash is stored; valid for 1 hour, usable once.
CREATE TABLE password_resets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id);
