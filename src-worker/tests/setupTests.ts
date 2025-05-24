// src-worker/tests/setupTests.ts
import { beforeAll, afterEach, afterAll } from "vitest";
import { server } from "./mocks/server";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.test
dotenv.config({ path: path.resolve(__dirname, ".env.test") });

beforeAll(() => {
  // Start the mock server before all tests
  server.listen({ onUnhandledRequest: "warn" }); // Log unhandled requests
  console.log(
    "Mock server started. Worker should be configured to use:",
    process.env.MOCK_AI_API_URL
  );
  console.log("Worker URL for tests:", process.env.WORKER_URL);
  console.log(
    "Worker API Key for tests:",
    process.env.WORKER_API_KEY ? "SET" : "NOT SET"
  );

  // Important: Ensure wrangler dev is running and LOCAL D1 is configured
  // You might want to add a health check to process.env.WORKER_URL here.
});

afterEach(() => {
  // Reset any runtime request handlers added during tests
  server.resetHandlers();
});

afterAll(() => {
  // Close the mock server after all tests
  server.close();
});

// You might also want to add a function here to clear your D1 database
// e.g., by shelling out to `wrangler d1 execute ... --local --command="DELETE FROM github_users;"`
// This would typically be run in a `beforeEach` if tests modify the DB
// and you want a clean state for each test.
// For now, let's assume tests either don't heavily pollute D1 or cleanup is manual.
export async function clearD1Database() {
  const { execSync } = await import("child_process");
  const dbName = "github-users-db-test"; // Match your wrangler.toml
  try {
    console.log(`Clearing D1 database: ${dbName}`);
    // Adjust path to schema.sql if your tests are not in src-worker root
    // Be careful with direct table deletion; depends on your schema and FKs
    execSync(
      `npx wrangler d1 execute ${dbName} --local --command="DELETE FROM github_users;"`,
      { stdio: "inherit" }
    );
    // Optionally re-apply schema if needed, or just delete rows
    // execSync(`npx wrangler d1 execute ${dbName} --local --file=./schema.sql`, { stdio: 'inherit' });
    console.log("D1 database cleared.");
  } catch (error) {
    console.error("Failed to clear D1 database:", error);
    // throw error; // Or handle as needed
  }
}
