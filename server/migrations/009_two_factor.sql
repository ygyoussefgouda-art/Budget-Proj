-- Two-step sign-in (authenticator app codes, TOTP). Off unless the person turns it on in Settings.
ALTER TABLE users ADD COLUMN totp_secret TEXT;              -- base32; set when setting it up
ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMPTZ;   -- on once the first code was checked
ALTER TABLE users ADD COLUMN totp_last_step BIGINT;         -- a code can't be used twice

-- One-time backup codes for a lost phone (only hashes are kept).
CREATE TABLE totp_backup_codes (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at   TIMESTAMPTZ
);
CREATE INDEX totp_backup_codes_user_idx ON totp_backup_codes(user_id);

-- After the right password, a short-lived ticket waits for the code (5 minutes, 5 tries).
CREATE TABLE login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0
);
CREATE INDEX login_challenges_expires_idx ON login_challenges(expires_at);
