-- Tags, foreign currency and "split with someone" on expenses.

-- Up to 5 tags per expense, stored lower-case without the '#'.
ALTER TABLE expenses ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 5);
CREATE INDEX expenses_tags_idx ON expenses USING GIN (tags);

-- Paid in another currency: the original bill and the rate typed in by the user.
-- `amount` stays the (converted) amount in the account currency, so every total keeps working.
ALTER TABLE expenses ADD COLUMN orig_amount BIGINT CHECK (orig_amount > 0);
ALTER TABLE expenses ADD COLUMN orig_currency TEXT CHECK (orig_currency ~ '^[A-Z]{3}$');
ALTER TABLE expenses ADD COLUMN fx_rate NUMERIC(18, 6) CHECK (fx_rate > 0);
ALTER TABLE expenses ADD CONSTRAINT expenses_fx_all_or_none
  CHECK ((orig_amount IS NULL) = (orig_currency IS NULL) AND (orig_currency IS NULL) = (fx_rate IS NULL));

-- Split: the expense keeps my share; the other person's share is an "Owed to me" loan entry
-- linked to it (at most one). Deleting the expense removes it too.
ALTER TABLE loan_entries ADD COLUMN expense_id BIGINT REFERENCES expenses(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX loan_entries_expense_uq ON loan_entries(expense_id) WHERE expense_id IS NOT NULL;
