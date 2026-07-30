import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Without this, dependency scanning walks every index.html in the tree —
  // including the upstream Excalidraw app and Tauri's build artifacts — and
  // fails on entry points that were never meant for this app.
  optimizeDeps: { entries: ["index.html"] },
});
