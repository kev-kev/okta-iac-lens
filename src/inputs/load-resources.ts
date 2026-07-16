/**
 * inputs/load-resources: I/O boundary that produces normalized `ParsedResource[]` from
 * either input source. Kept out of `cli.ts` (the entrypoint) so it's importable by tests
 * without running the CLI. `src/core` and `src/analysis` stay pure; all I/O is here.
 */

import type { ParsedResource } from "../core/parse-tfstate.js";
import type { AppNode, OktaGraph } from "../core/model.js";
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

/** Index a graph's `App` nodes by id (the tfstate `app_id` / live `appInstanceId` join key). */
function appsById(graph: OktaGraph): Map<string, AppNode> {
  return new Map(
    graph.nodes.filter((n): n is AppNode => n.kind === "App").map((a) => [a.id, a]),
  );
}

/**
 * LIVE individual-assignment resolver. For each app in the graph, ask Okta whether THIS user's
 * assignment is individual (`scope: USER`) or group-inherited (`scope: GROUP`) via
 * `GET /apps/{appId}/users/{userId}`; the USER-scoped apps are the individual channel for
 * `traceUser`. `scope` is the direct signal — no diffing against group-reached apps.
 *
 * (M13 Phase E replaced the original appLinks-diff design: `GET /users/{id}/appLinks` returns an
 * empty list for admin-assigned users, so it never surfaced individual grants at all.)
 *
 * Cost is one GET per graph app (N calls); fine at current scale. The PII rail holds — every call
 * is for `membership.user.id` alone, never the bulk `/apps/{id}/users` sweep, and no user enters
 * the graph. In live mode the graph IS the whole tenant, so there is no Terraform side to diff and
 * hence no "reachable but not in Terraform" drift here (state-vs-live drift is M14). `reader` is
 * injectable for tests.
 */
export async function resolveUserDirectApps(
  reader: OktaUserReader,
  graph: OktaGraph,
  membership: { user: UserRef; groupIds: string[] },
): Promise<AppNode[]> {
  const directApps: AppNode[] = [];
  for (const app of appsById(graph).values()) {
    const scope = await reader.getUserAppAssignmentScope(membership.user.id, app.id);
    if (scope === "USER") directApps.push(app);
  }
  return directApps;
}

/**
 * STATE/STATIC individual-assignment resolver: filter `okta_app_user` (`AppUserAssignment`) records
 * to this user, resolve their `appId`s to graph `App` nodes, dedupe. Deterministic, no network — the
 * `opts.directApps` input for a state-only `traceUser`. Records referencing an app absent from the
 * graph are skipped (state should always carry the app; nothing to surface as drift here).
 */
export function resolveUserDirectAppsFromState(
  resources: ParsedResource[],
  graph: OktaGraph,
  userId: string,
): AppNode[] {
  const byId = appsById(graph);
  const directApps: AppNode[] = [];
  const seen = new Set<string>();
  for (const r of resources) {
    if (r.kind !== "AppUserAssignment" || r.userId !== userId || seen.has(r.appId)) continue;
    const app = byId.get(r.appId);
    if (app) {
      directApps.push(app);
      seen.add(r.appId);
    }
  }
  return directApps;
}

/** Best-effort load of a local `.env` so OKTA_* vars are available; silent if absent. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env file — fine if the vars are already exported */
  }
}
