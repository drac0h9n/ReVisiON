// src-worker/tests/sync-user.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { clearD1Database } from "./setupTests"; // Import the D1 clear function

const WORKER_URL = process.env.WORKER_URL!;
const VALID_API_KEY = process.env.WORKER_API_KEY!;

const sampleUserProfile = {
  id: 12345,
  login: "testuser",
  name: "Test User",
  avatar_url: "https://example.com/avatar.png",
  email: "test@example.com",
};

describe("/sync-user Endpoint", () => {
  beforeEach(async () => {
    await clearD1Database(); // Ensure a clean DB state for each test
  });

  it("Should successfully sync a user profile with valid data and auth", async () => {
    const response = await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ profile: sampleUserProfile }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe("User profile synced successfully.");

    // Ideal: Query D1 directly or via another (test-only) endpoint to verify data persistence.
    // For pure black-box, we rely on the 200 OK and success message.
  });

  it("Should update an existing user profile (upsert)", async () => {
    // First sync
    await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ profile: sampleUserProfile }),
    });

    // Second sync with updated data
    const updatedProfile = { ...sampleUserProfile, name: "Test User Updated" };
    const response = await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ profile: updatedProfile }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // Verifying the update would require reading from D1, outside typical black-box.
  });

  it("Should return 400 if Content-Type is not application/json", async () => {
    const response = await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: "some text",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Expected JSON");
  });

  it("Should return 400 if JSON payload is malformed", async () => {
    const response = await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: '{"profile": malformed}',
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Invalid JSON");
  });

  it("Should return 400 if profile.id is missing", async () => {
    const { id, ...profileWithoutId } = sampleUserProfile;
    const response = await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ profile: profileWithoutId }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Missing profile fields (id, login)");
  });

  it("Should return 400 if profile.login is missing", async () => {
    const { login, ...profileWithoutLogin } = sampleUserProfile;
    const response = await fetch(`${WORKER_URL}/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ profile: { ...profileWithoutLogin } }), // ensure ID is present
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("Missing profile fields (id, login)");
  });
});
