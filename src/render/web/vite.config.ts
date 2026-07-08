import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

// Vite is rooted at this folder (index.html lives here). The dev server is allowed to read
// up to the repo root so the browser build can import the pure core in src/core. Output goes
// to dist-web/ at the repo root (gitignored), kept separate from the CLI's tsc dist/.
const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
// Loaded at dev-server start through Vite's SSR pipeline (handles NodeNext .js→.ts specifiers).
const devDepsPath = fileURLToPath(new URL("../../server/dev-deps.ts", import.meta.url)).replace(/\\/g, "/");

/**
 * M9: expose the local read-only API on the dev server only (`apply: "serve"`). The browser talks
 * to localhost here; the SSWS token stays in this Node process. `src/server/api.ts` owns the
 * security gate (GET-only, loopback Host, same-origin) and routing.
 */
function localApiPlugin(): PluginOption {
  return {
    name: "okta-iac-lens-local-api",
    apply: "serve",
    configureServer(server) {
      const mod = server.ssrLoadModule(devDepsPath);
      const deps = mod.then((m) => m.buildApiDeps());
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();
        void (async () => {
          try {
            const [{ handleApiRequest }, apiDeps] = await Promise.all([mod, deps]);
            const parsed = new URL(url, "http://localhost");
            const out = await handleApiRequest(
              {
                method: req.method ?? "GET",
                path: parsed.pathname,
                query: parsed.searchParams,
                headers: { host: req.headers.host, origin: req.headers.origin as string | undefined },
              },
              apiDeps,
            );
            res.statusCode = out.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(out.json));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
        })();
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), localApiPlugin()],
  server: { fs: { allow: [repoRoot] } },
  build: {
    outDir: fileURLToPath(new URL("../../../dist-web/", import.meta.url)),
    emptyOutDir: true,
  },
});
