import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite is rooted at this folder (index.html lives here). The dev server is allowed to read
// up to the repo root so the browser build can import the pure core in src/core. Output goes
// to dist-web/ at the repo root (gitignored), kept separate from the CLI's tsc dist/.
const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { fs: { allow: [repoRoot] } },
  build: {
    outDir: fileURLToPath(new URL("../../../dist-web/", import.meta.url)),
    emptyOutDir: true,
  },
});
