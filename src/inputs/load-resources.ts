/**
 * inputs/load-resources: I/O boundary that produces normalized `ParsedResource[]` from
 * either input source. Kept out of `cli.ts` (the entrypoint) so it's importable by tests
 * without running the CLI. `src/core` and `src/analysis` stay pure; all I/O is here.
 */

import type { ParsedResource } from "../core/parse-tfstate.js";
import { parseTfState } from "../core/parse-tfstate.js";
import { readTfStateFile } from "./tfstate-file.js";
import { mapApiSnapshot } from "./map-api.js";
import { HttpOktaReader, readOktaConfigFromEnv, readTenantSnapshot } from "./okta-api.js";

/** Read a `terraform show -json` export into normalized records (the coverage "state" side). */
export async function loadStateResources(path: string): Promise<ParsedResource[]> {
  return parseTfState(await readTfStateFile(path));
}

/**
 * Read the live tenant (read-only) into normalized records (the coverage "live" side).
 * Throws a clear, actionable error via `readOktaConfigFromEnv` when credentials are absent —
 * before any network call. `env` is injectable for tests.
 */
export async function loadLiveResources(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ParsedResource[]> {
  const reader = new HttpOktaReader(readOktaConfigFromEnv(env));
  return mapApiSnapshot(await readTenantSnapshot(reader));
}

/** Best-effort load of a local `.env` so OKTA_* vars are available; silent if absent. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env file — fine if the vars are already exported */
  }
}
