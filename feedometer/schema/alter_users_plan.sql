-- Additive: subscription plan on users. Not RBAC.
-- Guest is not a row and has no plan.
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';
UPDATE users SET plan = 'free' WHERE plan IS NULL;
