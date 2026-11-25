-- 2.3.0
-- Admin area: after the password and a two-step code, a session may open the admin area until this time.
ALTER TABLE sessions ADD COLUMN admin_until TIMESTAMPTZ;

-- How many people use the app: one row per account per day it was used (UTC), and whether that was
-- in the Android app, a browser, or both. Counts only; nothing about what was done. Kept ~400 days.
CREATE TABLE activity_days (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  android BOOLEAN NOT NULL DEFAULT false,
  web     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX activity_days_day_idx ON activity_days(day);
