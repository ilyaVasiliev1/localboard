import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["upstream-excalidraw/**", ".tmp/**", "dist/**"],
  },
});
