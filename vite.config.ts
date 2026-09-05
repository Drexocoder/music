// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      // Replit's preview proxy uses a generated host for each workspace.
      allowedHosts: true,
      // Keep the browser on one origin while the Replit development workflow
      // runs the yt-dlp service on its private local port.
      proxy: {
        "/api/download": {
          target: "http://127.0.0.1:8080",
          changeOrigin: true,
        },
        "/health": {
          target: "http://127.0.0.1:8080",
          changeOrigin: true,
        },
      },
    },
  },
  // Vercel needs a Node-compatible serverless output instead of the wrapper's
  // default Cloudflare worker target.
  nitro: {
    preset: "vercel",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
