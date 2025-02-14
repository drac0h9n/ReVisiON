-- schema.sql
-- Defines the schema for the github_users table in the D1 database.

-- Create the table only if it doesn't already exist.
CREATE TABLE IF NOT EXISTS github_users (
    -- Primary Key: The unique identifier from GitHub.
    github_id INTEGER PRIMARY KEY,

    -- GitHub login/username. Should be unique across GitHub.
    -- Marked as NOT NULL and UNIQUE.
    login TEXT NOT NULL UNIQUE,

    -- User's display name from GitHub (can be null).
    name TEXT,

    -- URL to the user's avatar image (should generally exist, but allow NULL defensively).
    avatar_url TEXT,

    -- User's public email from GitHub (can be null or not provided).
    email TEXT,

    -- Timestamp when the user was first synced to our database.
    -- Defaults to the time the row is inserted.
    first_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Timestamp when the user's information was last updated in our database.
    -- Should be updated every time a sync occurs.
    last_synced_at TIMESTAMP NOT NULL
);

-- Optional: You could add indexes here later for performance if needed, e.g.:
-- CREATE INDEX IF NOT EXISTS idx_users_last_synced ON github_users(last_synced_at);

-- npx wrangler d1 execute github-users-db --remote --file=./schema.sql