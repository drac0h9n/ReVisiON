// src/types/chat.ts

/**
 * Represents a single message in the chat interface.
 */
export interface ChatMessage {
  /** Unique identifier for the message (e.g., UUID). */
  id: string;
  /** Who sent the message. */
  sender: "user" | "ai";
  /** The main text content of the message (can be Markdown). */
  text: string;
  /** Optional: Asset URL for a small thumbnail associated with the message (primarily for user messages showing the related screenshot). */
  // imageAssetUrl?: string | null; // Allow null Explicitly
  /** Timestamp when the message was created (e.g., Date.now()). */
  timestamp: number;
  /** Optional: Indicates if this is an AI message currently being generated. */
  isLoading?: boolean;
  /** Optional: Indicates if there was an error generating this AI message. */
  isError?: boolean;
  /** Optional: Any additional metadata (can be extended as needed). */
  metadata?: Record<string, any>;
}
