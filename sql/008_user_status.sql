-- Accounts are requested by the person and approved by the manager.
-- Authorisation stays with the manager; the password belongs to the
-- individual, so nobody else ever knows it.
ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'deactivated'));

UPDATE users SET status = 'active' WHERE deleted_at IS NULL;
UPDATE users SET status = 'deactivated' WHERE deleted_at IS NOT NULL;