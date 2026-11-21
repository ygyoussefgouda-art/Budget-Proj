-- Optional receipt (photo or PDF) attached to an expense. One per expense.
-- Stored in the database so `pg_dump` backs it up and deleting the expense removes it.
CREATE TABLE receipts (
  expense_id BIGINT PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size       INTEGER NOT NULL CHECK (size > 0),
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receipts_user_idx ON receipts(user_id);
