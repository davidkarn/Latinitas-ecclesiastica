import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import sirv from "sirv";
import { defineConfig, type Plugin } from "vite";

/** In development, serve the generated API (dist/api, or $API_DIR) at /api, with Range support for audio seeking. */
function localApi(): Plugin {
  const dir = path.resolve(import.meta.dirname, process.env.API_DIR ?? "dist/api");
  const serve = sirv(dir, { dev: true, etag: true });
  const mount: Plugin["configureServer"] = server => {
    server.middlewares.use("/api", (req, res, next) => serve(req, res, next));
  };
  return { name: "learnlatin-api", configureServer: mount, configurePreviewServer: mount as Plugin["configurePreviewServer"] };
}

/**
 * The generator writes the API into dist/api, so web/dist is the whole site. Vite would normally empty dist
 * before a build; instead remove everything except api/ (and the generator's api.staging-/.tmp-/.old- dirs).
 */
function keepApi(): Plugin {
  let outDir = "";
  return {
    name: "learnlatin-keep-api",
    apply: "build",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    buildStart() {
      if (!fs.existsSync(outDir)) return;
      for (const name of fs.readdirSync(outDir)) {
        if (!/^api($|\.)/.test(name)) fs.rmSync(path.join(outDir, name), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi(), keepApi()],
  build: { emptyOutDir: false },
  server: { fs: { allow: [".."] } },
});
