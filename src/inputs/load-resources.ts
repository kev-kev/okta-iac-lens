/**
 * inputs/load-resources: I/O boundary that produces normalized `ParsedResource[]` from
 * either input source. Kept out of `cli.ts` (the entrypoint) so it's importable by tests
 * without running the CLI. `src/core` and `src/analysis` stay pure; all I/O is here.
 */

import type { ParsedResource } from "../core/parse-tfstate.js";
import type { UserRef } from "../core/access-paths.js";
import { parseTfState } from "../core/parse-tfstate.js";
import { readTfStateFile } from "./tfstate-file.js";
import { mapApiSnapshot } from "./map-api.js";
import type { OktaUserReader } from "./okta-api.js";
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

/**
 * Resolve ONE user (by email/login) to their group-id membership, live and read-only. This is
 * the trace INPUT for `traceUser` — a user is never a graph node. Throws the actionable
 * missing-credentials error via `readOktaConfigFromEnv` BEFORE any network call. `reader` is
 * injectable for tests; `env` too. PII boundary: the returned `user.login` is the only user
 * attribute we surface — never persisted here.
 */
export async function loadUserMembership(
  login: string,
  reader?: OktaUserReader,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ user: UserRef; groupIds: string[] }> {
  const r = reader ?? new HttpOktaReader(readOktaConfigFromEnv(env));
  const raw = await r.getUserByLogin(login);
  const groupIds = await r.listUserGroupIds(raw.id);
  return {
    user: { id: raw.id, login: raw.profile?.login ?? raw.profile?.email ?? login },
    groupIds,
  };
}

/** Best-effort load of a local `.env` so OKTA_* vars are available; silent if absent. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env file — fine if the vars are already exported */
  }
}
