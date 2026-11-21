-- The day of the month a user's budget month starts (the day they get their money).
-- A "month" labelled 2026-11 then runs from 2026-11-<day> up to 2026-12-<day - 1>.
-- Limited to 1..28 so every month has that day.
ALTER TABLE users
  ADD COLUMN month_start_day INTEGER NOT NULL DEFAULT 1
  CHECK (month_start_day BETWEEN 1 AND 28);
