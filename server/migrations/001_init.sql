-- Budget me schema. Money is stored as BIGINT minor units (piastres/cents).
-- Every data table is scoped by user_id so the app can grow to many users
-- without a data migration.

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'EGP',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

CREATE TABLE categories (
  id      BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_uni  BOOLEAN NOT NULL DEFAULT false,
  sort    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX categories_user_name_uq ON categories(user_id, lower(name));

CREATE TABLE month_budgets (
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month     TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  income    BIGINT NOT NULL DEFAULT 0 CHECK (income >= 0),
  uni_days  NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (uni_days >= 0),
  uni_weeks NUMERIC(6,2) NOT NULL DEFAULT 4 CHECK (uni_weeks >= 0),
  uni_cost  BIGINT NOT NULL DEFAULT 0 CHECK (uni_cost >= 0),
  save_plan BIGINT NOT NULL DEFAULT 0 CHECK (save_plan >= 0),
  loan_plan BIGINT NOT NULL DEFAULT 0 CHECK (loan_plan >= 0),
  PRIMARY KEY (user_id, month)
);

CREATE TABLE category_plans (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  planned     BIGINT NOT NULL CHECK (planned >= 0),
  PRIMARY KEY (user_id, month, category_id)
);

CREATE TABLE expenses (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT '',
  amount      BIGINT NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_user_date_idx ON expenses(user_id, date DESC, id DESC);
CREATE INDEX expenses_category_idx ON expenses(category_id);

CREATE TABLE goals (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  target        BIGINT NOT NULL CHECK (target > 0),
  start_balance BIGINT NOT NULL DEFAULT 0 CHECK (start_balance >= 0),
  monthly       BIGINT NOT NULL DEFAULT 0 CHECK (monthly >= 0),
  sort          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX goals_user_idx ON goals(user_id);

CREATE TABLE goal_entries (
  id      BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id BIGINT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  type    TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  amount  BIGINT NOT NULL CHECK (amount > 0),
  note    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX goal_entries_user_date_idx ON goal_entries(user_id, date);
CREATE INDEX goal_entries_goal_idx ON goal_entries(goal_id);

CREATE TABLE loan_entries (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  person    TEXT NOT NULL CHECK (length(trim(person)) > 0),
  direction TEXT NOT NULL CHECK (direction IN ('borrowed', 'lent')),
  kind      TEXT NOT NULL CHECK (kind IN ('principal', 'repayment')),
  amount    BIGINT NOT NULL CHECK (amount > 0),
  note      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX loan_entries_user_date_idx ON loan_entries(user_id, date);
