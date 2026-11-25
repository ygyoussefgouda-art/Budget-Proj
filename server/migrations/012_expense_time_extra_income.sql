-- 2.2.0
-- Time of day on expenses ("HH:MM", the phone's clock). Optional: older expenses have none.
ALTER TABLE expenses ADD COLUMN time_of_day TEXT CHECK (time_of_day IS NULL OR time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Extra (variable) income on top of the month's fixed income: freelance work, a gift, a bonus.
-- Each entry counts in the budget month its date falls in.
CREATE TABLE incomes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount      BIGINT NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX incomes_user_date_idx ON incomes(user_id, date DESC, id DESC);

-- Undo can bring back a deleted extra income.
ALTER TABLE trash DROP CONSTRAINT trash_kind_check;
ALTER TABLE trash ADD CONSTRAINT trash_kind_check
  CHECK (kind IN ('expense', 'goal_entry', 'loan_entry', 'goal', 'loan_person', 'income'));
