-- The invite code for sign-up was removed (owner's choice, 2026-11-22). Drop any saved code.
-- (The CHECK on app_settings.key in 007 still allows the old key name; nothing writes it any more.)
DELETE FROM app_settings WHERE key = 'invite_code';
