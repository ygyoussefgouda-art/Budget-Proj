-- 2.6.0
-- The app's accent colour (owner chose five). Saved on the account so every device shows the same one.
ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT 'lime'
  CHECK (accent IN ('lime', 'sky', 'violet', 'pink', 'lemon'));
