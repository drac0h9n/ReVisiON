// src/auth.ts

import { Env } from "./types";
import { errorResponse } from "./utils";

/**
 * Authenticates the incoming request based on the Authorization header.
 * @param request - The incoming Request object.
 * @param env - The Worker environment variables.
 * @returns `null` if authentication is successful, otherwise a `Response` object indicating the error.
 */
export function authenticateRequest(
  request: Request,
  env: Env
): Response | null {
  const authHeader = request.headers.get("Authorization");
  const expectedApiKey = env.WORKER_API_KEY;

  if (!expectedApiKey) {
    console.error("CRITICAL: WORKER_API_KEY environment variable not set!");
    return errorResponse(
      "Internal Server Error: API Key configuration missing",
      500
    );
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(
      "Unauthorized: Missing or malformed Authorization header",
      401
    );
  }

  const providedKey = authHeader.substring(7); // Extract key after "Bearer "

  if (providedKey !== expectedApiKey) {
    return errorResponse("Unauthorized: Invalid API Key", 401);
  }

  // Authentication successful
  return null;
}
