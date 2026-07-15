/**
 * inputs/load-resources: I/O boundary that produces normalized `ParsedResource[]` from
 * either input source. Kept out of `cli.ts` (the entrypoint) so it's importable by tests
 * without running the CLI. `src/core` and `src/analysis` stay pure; all I/O is here.
 */

import type { ParsedResource } from "../core/parse-tfstate.js";
import type { AppNode, OktaGraph } from "../core/model.js";
import type { UserRef } from "../core/access-paths.js";
import { appsGrantedByGroup } from "../core/access-paths.js";
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

/**
 * appLinks entries that matched NO graph `App` node — an app Okta shows the user that is not in
 * Terraform at all (a click-ops app). Never silently dropped: surfaced by `renderUserTrace` as
 * "reachable but not in Terraform". This is the only pre-M14 surface that shows this drift.
 */
export interface UnmatchedAppLink {
  appInstanceId: string;
  label: string;
}

/** The individual-assignment side-inputs for `traceUser`, resolved live or from state. */
export interface DirectAppsResult {
  /**
   * Apps this user reaches by INDIVIDUAL assignment, matched to graph `App` nodes — the
   * `opts.directApps` input for `traceUser`. Group-reached apps are already subtracted, so this
   * is genuinely the individual-only channel (`traceUser` re-subtracts defensively regardless).
   */
  directApps: AppNode[];
  /** appLinks that matched no graph app (live only; always empty from the state resolver). */
  unmatchedApps: UnmatchedAppLink[];
}

/** Index a graph's `App` nodes by id (the `appInstanceId` / tfstate `app_id` join key). */
function appsById(graph: OktaGraph): Map<string, AppNode> {
  return new Map(
    graph.nodes.filter((n): n is AppNode => n.kind === "App").map((a) => [a.id, a]),
  );
}

/**
 * LIVE individual-assignment resolver: the appLinks diff. Reads the apps Okta actually shows this
 * user (`GET /users/{id}/appLinks`, read-only) and subtracts what their groups already grant — the
 * remainder is individual/click-ops provisioning. appLinks is per-LINK, so we dedupe by
 * `appInstanceId`. Entries matching a graph app become `directApps`; entries matching NO graph app
 * (a click-ops app absent from Terraform) become `unmatchedApps` — surfaced, never dropped.
 *
 * The PII rail holds: this is a per-user lookup (`membership.user.id`), never a bulk
 * `/apps/{id}/users` sweep, and no user enters the graph. `reader` is injectable for tests.
 */
export async function resolveUserDirectApps(
  reader: OktaUserReader,
  graph: OktaGraph,
  membership: { user: UserRef; groupIds: string[] },
): Promise<DirectAppsResult> {
  const links = await reader.listUserAppLinks(membership.user.id);

  const groupReached = new Set<string>();
  for (const groupId of membership.groupIds) {
    for (const app of appsGrantedByGroup(graph, groupId)) groupReached.add(app.id);
  }

  const byId = appsById(graph);
  const directApps: AppNode[] = [];
  const unmatchedApps: UnmatchedAppLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.appInstanceId)) continue; // per-link dedupe -> per-app
    seen.add(link.appInstanceId);
    const app = byId.get(link.appInstanceId);
    if (!app) {
      unmatchedApps.push({ appInstanceId: link.appInstanceId, label: link.label });
      continue;
    }
    if (groupReached.has(app.id)) continue; // already granted by a group — not individual
    directApps.push(app);
  }
  return { directApps, unmatchedApps };
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
