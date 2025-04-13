// src-worker/src/types.ts

/**
 * Environment variables expected by the Worker.
 */
export interface Env {
  /** D1 Database binding. */
  DB: D1Database;

  /** The secret API key expected from the Tauri backend. */
  WORKER_API_KEY: string; // Key Tauri uses to talk to this worker

  /** The secret URL for the custom AI API (OpenAI compatible). */
  CUSTOM_AI_API_URL: string; // URL this worker calls

  /** The secret API Key for the custom AI API. */
  CUSTOM_AI_API_KEY: string; // Key this worker uses to talk to AI API
}

/** Github User Profile (from auth flow) */
export interface GithubUserProfile {
  login: string;
  id: number;
  name?: string | null;
  avatar_url: string;
  email?: string | null;
}

/** Payload from Tauri for the /sync-user endpoint */
export interface BackendSyncPayload {
  profile: GithubUserProfile;
}

/** Payload from Tauri for the /query endpoint */
export interface WorkerQueryRequest {
  text: string;
  // Expecting data URL format: data:image/png;base64,...
  base64ImageDataUrl?: string | null;
}

/** Structure for OpenAI Vision API messages */
export interface OpenAIMessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "low" | "high" | "auto" }; // Added detail option
}
interface OpenAIMessage {
  role: "user" | "assistant" | "system";
  content: string | OpenAIMessageContent[];
}
export interface OpenAIVisionPayload {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  // Add other OpenAI parameters as needed
}

/** Expected response structure from the custom AI API (OpenAI compatible) */
interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
  };
  finish_reason?: string; // etc.
}
export interface OpenAICompletionResponse {
  id?: string;
  choices: OpenAIChoice[];
  usage?: object; // etc.
  error?: {
    // Handle API errors directly
    message: string;
    type: string;
    // ... other error fields
  };
}

/** Response from this Worker back to Tauri for the /query endpoint */
export interface WorkerQueryResponse {
  ai_text: string;
}

/** Standard structure for API JSON responses (used internally by utils) */
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T; // Use this for /sync-user response if needed
  // For /query, we use WorkerQueryResponse directly, not wrapped in 'data'
  ai_text?: string; // Can directly include ai_text for query response
}
