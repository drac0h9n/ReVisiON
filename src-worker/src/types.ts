// src/types.ts

/**
 * Environment variables expected by the Worker.
 * These are configured in wrangler.toml or via Cloudflare Dashboard secrets.
 */
export interface Env {
  /**
   * D1 Database binding. Provides access to the database instance.
   */
  DB: D1Database;

  /**
   * The secret API key expected in the Authorization header from the Tauri backend.
   * Should be set as a secret using `wrangler secret put WORKER_API_KEY`.
   */
  WORKER_API_KEY: string;
}

/**
 * Represents the structure of the user profile data received from GitHub,
 * mirroring the Rust `GithubUserProfile` struct.
 */
export interface GithubUserProfile {
  login: string;
  id: number; // Use number for u64 from Rust
  name?: string | null; // Optional fields can be string or null
  avatar_url: string; // Assuming this is always present based on Rust struct (handle null defensively if needed)
  email?: string | null; // Optional fields can be string or null
}

/**
 * Represents the expected payload structure in the POST request body
 * from the Tauri backend, mirroring the Rust `BackendSyncPayload`.
 */
export interface BackendSyncPayload {
  profile: GithubUserProfile;
  // Include other fields if the Rust backend sends them, e.g.:
  // access_token?: string;
}

/**
 * Standard structure for API JSON responses.
 */
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}
