-- Recurring expenses and undo for deletes.

-- A monthly rule: "every month on day N, add this expense".
CREATE TABLE recurring_rules (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- CASCADE only so backup-restore/reset can clear categories; the API refuses to delete
  -- a category that still has recurring rules.
  category_id  BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount       BIGINT NOT NULL CHECK (amount > 0),
  description  TEXT NOT NULL DEFAULT '',
  day_of_month SMALLINT NOT NULL CHECK (day_of_month BETWEEN 1 AND 31), -- 29-31 fall back to the month's last day
  start_date   DATE NOT NULL,
  end_date     DATE CHECK (end_date IS NULL OR end_date >= start_date),
  auto_add     BOOLEAN NOT NULL DEFAULT false,
  paused       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recurring_rules_user_idx ON recurring_rules(user_id);

-- Each occurrence that was handled (added or skipped). The primary key makes it impossible
-- to add the same occurrence twice, even with two taps or two phones at the same moment.
CREATE TABLE recurring_occurrences (
  rule_id    BIGINT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date   DATE NOT NULL,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('added', 'skipped')),
  expense_id BIGINT REFERENCES expenses(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, due_date)
);
CREATE INDEX recurring_occurrences_user_idx ON recurring_occurrences(user_id);

-- Undo: a deleted expense / savings entry / loan entry waits here (with its receipt) for a
-- short time, then is purged for good. Normal queries never see it.
CREATE TABLE trash (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('expense', 'goal_entry', 'loan_entry')),
  item         JSONB NOT NULL,
  receipt_mime TEXT,
  receipt_data BYTEA,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trash_user_idx ON trash(user_id, deleted_at);
CREATE INDEX trash_deleted_idx ON trash(deleted_at);
