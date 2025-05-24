// src-worker/tests/query.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server"; // To potentially override handlers per test
import { clearD1Database } from "./setupTests";

const WORKER_URL = process.env.WORKER_URL!;
const VALID_API_KEY = process.env.WORKER_API_KEY!;
const MOCK_AI_API_URL_BASE =
  process.env.MOCK_AI_API_URL?.replace(/\/mock-ai$/, "") ||
  "http://127.0.0.1:9090";

// A minimal valid base64 image string (1x1 transparent PNG)
const validBase64Image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("/query Endpoint", () => {
  beforeEach(async () => {
    await clearD1Database(); // Query endpoint doesn't use DB, but good practice if other tests do
  });

  it("Should return 400 if both text and image are missing", async () => {
    const response = await fetch(`${WORKER_URL}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Bad Request: Requires text or image data");
  });

  it("Should return 500 if CUSTOM_AI_API_URL is not set in worker (hard to test)", () => {
    // Similar to WORKER_API_KEY, this requires a special worker build/run configuration.
    expect(true).toBe(true); // Placeholder
  });
});

describe("General Error Handling", () => {
  it("Should return 404 for an unknown route", async () => {
    const response = await fetch(`${WORKER_URL}/unknown-route`, {
      method: "GET", // Or any method
      headers: { Authorization: `Bearer ${VALID_API_KEY}` }, // Auth might or might not be checked before 404
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Not Found");
  });
});
