-- 1.2.0
-- Category icon and colour (optional; the app's own lists, checked again in validation.ts).
ALTER TABLE categories ADD COLUMN icon TEXT CHECK (icon IS NULL OR icon ~ '^[a-z-]{1,30}$');
ALTER TABLE categories ADD COLUMN color TEXT CHECK (color IS NULL OR color ~ '^[a-z]{1,20}$');

-- Budget rollover: unspent budget in a category carries into the next month. Off unless turned on.
ALTER TABLE users ADD COLUMN rollover BOOLEAN NOT NULL DEFAULT false;

-- Merge repeats: a new expense with the same category, date and description as one added in the last
-- 5 minutes is added to it ("Transport 10" + "Transport 10" = "Transport 20"). Off unless turned on.
ALTER TABLE users ADD COLUMN merge_repeats BOOLEAN NOT NULL DEFAULT false;

-- Undo can also bring back a whole savings goal (with its entries) or a person in Loans (all entries).
ALTER TABLE trash DROP CONSTRAINT trash_kind_check;
ALTER TABLE trash ADD CONSTRAINT trash_kind_check
  CHECK (kind IN ('expense', 'goal_entry', 'loan_entry', 'goal', 'loan_person'));
