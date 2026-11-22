-- Email on accounts: required for new sign-ups, used for "Forgot password?" codes and sign-in.
-- Older accounts may have none until they add one in Settings.
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

-- Reset codes now come from an admin or by email.
ALTER TABLE password_resets ADD COLUMN via TEXT NOT NULL DEFAULT 'admin' CHECK (via IN ('admin', 'email'));
-- Wrong tries against the current code (it stops working after a few).
ALTER TABLE password_resets ADD COLUMN attempts INT NOT NULL DEFAULT 0;
