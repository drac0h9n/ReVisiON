// src/utils.ts

import { ApiResponse } from "./types";

/**
 * Creates a standard JSON Response object.
 * @param data - The data payload for the response.
 * @param status - The HTTP status code (default: 200).
 * @param headers - Additional headers to include.
 * @returns A Response object.
 */
export function jsonResponse<T>(
  data: ApiResponse<T> | Omit<ApiResponse<T>, "success">, // Allow omitting success, defaults based on status
  status: number = 200,
  headers: HeadersInit = {}
): Response {
  const body: ApiResponse<T> = {
    success: status >= 200 && status < 300, // Infer success from status code
    ...data,
  };

  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Creates an error JSON Response object.
 * @param message - The error message.
 * @param status - The HTTP error status code (default: 500).
 * @returns A Response object.
 */
export function errorResponse(message: string, status: number = 500): Response {
  console.error(`Error Response (${status}): ${message}`); // Log the error server-side
  return jsonResponse({ message }, status); // success will be false due to status code
}
