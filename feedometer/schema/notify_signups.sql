-- Waitlist ledger. KV remains the live Notify capture; this table is filled daily.
CREATE TABLE IF NOT EXISTS notify_signups (
  email TEXT PRIMARY KEY,
  joined_at TEXT NOT NULL,
  source TEXT,
  country TEXT,
  city TEXT,
  synced_at TEXT NOT NULL
);
