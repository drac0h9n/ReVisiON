// src/db.ts

import { GithubUserProfile, Env } from "./types";

/**
 * Upserts (Inserts or Updates) the GitHub user profile into the D1 database.
 * @param profile - The GitHub user profile data.
 * @param db - The D1Database instance from the environment.
 * @returns A Promise that resolves with the D1Result on success.
 * @throws An error if the database operation fails.
 */
export async function upsertUserProfile(
  profile: GithubUserProfile,
  db: D1Database
): Promise<D1Result> {
  const now = new Date().toISOString(); // Use ISO 8601 format for timestamps

  // SQL statement for Upsert using ON CONFLICT (SQLite syntax)
  const upsertSql = `
        INSERT INTO github_users (
            github_id,
            login,
            name,
            avatar_url,
            email,
            last_synced_at
            -- first_synced_at is handled by DEFAULT CURRENT_TIMESTAMP on the table
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(github_id) DO UPDATE SET
            login = excluded.login,
            name = excluded.name,
            avatar_url = excluded.avatar_url,
            email = excluded.email,
            last_synced_at = excluded.last_synced_at;
    `;

  try {
    const stmt = db.prepare(upsertSql);
    const info = await stmt
      .bind(
        profile.id,
        profile.login,
        profile.name ?? null, // Use null for undefined/null optional values
        profile.avatar_url ?? null, // Use null if avatar_url can potentially be null/undefined
        profile.email ?? null, // Use null for undefined/null optional values
        now // Update last_synced_at timestamp
      )
      .run(); // Use run() for INSERT/UPDATE/DELETE

    console.log(
      `Successfully upserted user ID: ${profile.id}. D1 meta: ${JSON.stringify(
        info.meta
      )}`
    );
    return info;
  } catch (e: any) {
    console.error(
      `Database upsert failed for user ID ${profile.id}: ${e.message}`,
      e.stack
    );
    // Re-throw the error to be caught by the main handler
    throw new Error(`Database operation failed: ${e.message}`);
  }
}

/**
 * Optional: Function to create the table if it doesn't exist.
 * You would typically run this once via wrangler d1 execute or manually.
 * It could be called defensively, but adds overhead to every request.
 */
export async function ensureTableExists(db: D1Database): Promise<void> {
  const createTableSql = `
        CREATE TABLE IF NOT EXISTS github_users (
            github_id INTEGER PRIMARY KEY,
            login TEXT NOT NULL UNIQUE, -- Add UNIQUE constraint if login should be unique too
            name TEXT,
            avatar_url TEXT,
            email TEXT,
            first_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_synced_at TIMESTAMP NOT NULL
        );
    `;
  try {
    await db.exec(createTableSql);
    console.log("Table 'github_users' checked/created successfully.");
  } catch (e: any) {
    console.error(`Failed to ensure table exists: ${e.message}`);
    // Decide how to handle this - maybe throw?
  }
}
