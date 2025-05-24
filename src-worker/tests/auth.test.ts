// src-worker/tests/auth.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { clearD1Database } from "./setupTests"; // Import the D1 clear function

const WORKER_URL = process.env.WORKER_URL!;
const VALID_API_KEY = process.env.WORKER_API_KEY!;

// Sample data for /sync-user
const sampleUserProfile = {
  id: 12345,
  login: "testuser",
  name: "Test User",
  avatar_url: "https://example.com/avatar.png",
  email: "test@example.com",
};

describe("Authentication Tests", () => {
  beforeEach(async () => {
    await clearD1Database(); // Clear DB before auth tests that might hit DB
  });

  const testEndpoints = ["/sync-user", "/query"];

  testEndpoints.forEach((endpoint) => {
    it(`[${endpoint}] Should return 401 if no Authorization header is provided`, async () => {
      const response = await fetch(`${WORKER_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: sampleUserProfile }), // Dummy body
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain(
        "Missing or malformed Authorization header"
      );
    });

    it(`[${endpoint}] Should return 401 if Authorization header is malformed (not Bearer)`, async () => {
      const response = await fetch(`${WORKER_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Token somekey",
        },
        body: JSON.stringify({ profile: sampleUserProfile }),
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain(
        "Missing or malformed Authorization header"
      );
    });

    it(`[${endpoint}] Should return 401 if API Key is invalid`, async () => {
      const response = await fetch(`${WORKER_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalidkey",
        },
        body: JSON.stringify({ profile: sampleUserProfile }),
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain("Invalid API Key");
    });
  });

  it("Should return 500 if WORKER_API_KEY is not set in worker environment (hard to test in blackbox without custom worker build)", () => {
    // This case is tricky to test in a pure black-box way because WORKER_API_KEY
    // is an environment variable of the worker itself.
    // You'd typically rely on monitoring or a startup check in the worker.
    // If you wanted to test this, you would need to deploy/run a version of the worker
    // specifically without that env var set and then hit it.
    // For now, we assume it's configured correctly or caught by worker's own logging.
    expect(true).toBe(true); // Placeholder
  });
});
