// src-worker/tests/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./setupTests.ts"],
    // 你也可以用 describe.sequential 来控制单个文件内的测试顺序
  },
});
