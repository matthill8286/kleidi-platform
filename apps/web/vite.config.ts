import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://localhost:4100";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    // Signed upload links point here; Host is kept, so the signature still matches.
    proxy: { "/api": api, "/health": api, "/kleidi-documents": "http://localhost:8333" },
  },
});
