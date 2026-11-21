-- Offline entry: an expense typed in without a connection gets an id made on the phone.
-- When it is sent (maybe more than once, after a flaky connection), the same id can only
-- ever create one expense per account.
ALTER TABLE expenses ADD COLUMN client_id TEXT CHECK (client_id ~ '^[A-Za-z0-9-]{8,64}$');
CREATE UNIQUE INDEX expenses_client_id_uq ON expenses(user_id, client_id) WHERE client_id IS NOT NULL;
