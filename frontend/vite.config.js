import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy all backend calls (prefixed with /api) to the Express server on :4000,
// so the frontend never hardcodes host/port and there are no CORS surprises.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
