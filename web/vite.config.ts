import path from "node:path";
import react from "@vitejs/plugin-react";
import sirv from "sirv";
import { defineConfig, type Plugin } from "vite";

/** In development, serve the generated API (../dist/api, or $API_DIR) at /api, with Range support for audio seeking. */
function localApi(): Plugin {
  const dir = path.resolve(import.meta.dirname, process.env.API_DIR ?? "../dist/api");
  const serve = sirv(dir, { dev: true, etag: true });
  const mount: Plugin["configureServer"] = server => {
    server.middlewares.use("/api", (req, res, next) => serve(req, res, next));
  };
  return { name: "learnlatin-api", configureServer: mount, configurePreviewServer: mount as Plugin["configurePreviewServer"] };
}

export default defineConfig({
  plugins: [react(), localApi()],
  server: { fs: { allow: [".."] } },
});
