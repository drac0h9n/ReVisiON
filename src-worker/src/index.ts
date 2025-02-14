// src/index.ts

import { Env, BackendSyncPayload, ApiResponse } from "./types";
import { jsonResponse, errorResponse } from "./utils";
import { authenticateRequest } from "./auth";
import { upsertUserProfile /*, ensureTableExists */ } from "./db";

export default {
  /**
   * Handles incoming fetch events.
   * @param request - The incoming request.
   * @param env - Environment variables (including bindings).
   * @param ctx - Execution context.
   * @returns A Response promise.
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Optional: Ensure table exists on first request or periodically.
    // Be mindful of performance implications if called on every request.
    // ctx.waitUntil(ensureTableExists(env.DB));

    const url = new URL(request.url);

    // --- Basic Routing & Method Check ---
    if (url.pathname !== "/sync-user") {
      return errorResponse("Not Found", 404);
    }
    if (request.method !== "POST") {
      return errorResponse("Method Not Allowed", 405);
    }

    try {
      // --- Authentication ---
      const authErrorResponse = authenticateRequest(request, env);
      if (authErrorResponse) {
        return authErrorResponse; // Return 401/500 response if authentication fails
      }
      console.log("Request authenticated successfully.");

      // --- Request Body Parsing & Validation ---
      if (request.headers.get("Content-Type") !== "application/json") {
        return errorResponse(
          "Bad Request: Expected Content-Type: application/json",
          400
        );
      }

      let payload: BackendSyncPayload;
      try {
        payload = await request.json<BackendSyncPayload>();
      } catch (e: any) {
        return errorResponse(
          `Bad Request: Invalid JSON payload - ${e.message}`,
          400
        );
      }

      // Basic payload validation
      if (!payload?.profile?.id || !payload?.profile?.login) {
        return errorResponse(
          "Bad Request: Missing required fields in profile (id, login)",
          400
        );
      }
      console.log(`Received valid payload for user ID: ${payload.profile.id}`);

      // --- Database Interaction ---
      try {
        await upsertUserProfile(payload.profile, env.DB);

        // --- Success Response ---
        console.log(
          `Sync process completed successfully for user ID: ${payload.profile.id}`
        );
        // Return simple success message
        return jsonResponse<null>(
          { message: "User profile synced successfully." },
          200
        );
        // Or return the profile data if the client needs confirmation
        // return jsonResponse<GithubUserProfile>({ data: payload.profile }, 200);
      } catch (dbError: any) {
        // Error during DB operation (already logged in db.ts)
        return errorResponse(
          dbError.message || "Database operation failed",
          500
        );
      }
    } catch (e: any) {
      // --- Catch-all for unexpected errors ---
      console.error(
        "Unhandled error during request processing:",
        e.message,
        e.stack
      );
      return errorResponse("Internal Server Error", 500);
    }
  },
};
