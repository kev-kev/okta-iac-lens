/**
 * access-paths: graph traversal.
 *
 * PURE. Answers "what does this group grant, and under which policies?" using the
 * two separate policy layers. Pure id matching — no Expression Language evaluation.
 */

import type {
  AppAuthPolicyNode,
  AppNode,
  GlobalSessionPolicyNode,
  GroupNode,
  GroupRuleNode,
  NodeKind,
  OktaGraph,
} from "./model.js";

export interface TraceResult {
  group: GroupNode;
  /** Apps the group grants, in grant (source) order. */
  apps: AppNode[];
  /** The global session policy applied to the group, or null if none. */
  globalSessionPolicy: GlobalSessionPolicyNode | null;
  /**
   * Per-app app auth policy, keyed by app id. `null` => the app falls back to the
   * org default app sign-on policy (it is NOT unprotected).
   */
  appAuthPolicies: Record<string, AppAuthPolicyNode | null>;
}

export interface GraphSummary {
  groups: number;
  apps: number;
  groupRules: number;
  globalSessionPolicies: number;
  appAuthPolicies: number;
}

// --- Shared edge-walk helpers. Pure; each answers one hop of the access model. ---
// `trace`, `traceApp`, `traceUser`, and `rankRisk` (analysis) all compose these so the
// traversal semantics (grant order, dedupe, "org default != unprotected") live in one place.

/** grants: Group -> App. Apps a group grants, in grant (edge) order, deduped. */
export function appsGrantedByGroup(graph: OktaGraph, groupId: string): AppNode[] {
  const apps: AppNode[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "grants" || edge.from !== groupId || seen.has(edge.to)) continue;
    const app = graph.nodes.find((n): n is AppNode => n.kind === "App" && n.id === edge.to);
    if (app) {
      apps.push(app);
      seen.add(edge.to);
    }
  }
  return apps;
}

/** grants: Group -> App (reverse). Groups granting an app, in edge order, deduped. */
export function groupsGrantingApp(graph: OktaGraph, appId: string): GroupNode[] {
  const groups: GroupNode[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "grants" || edge.to !== appId || seen.has(edge.from)) continue;
    const group = graph.nodes.find((n): n is GroupNode => n.kind === "Group" && n.id === edge.from);
    if (group) {
      groups.push(group);
      seen.add(edge.from);
    }
  }
  return groups;
}

/** appliesTo: GlobalSessionPolicy -> Group. At most one applies; take the first. */
export function sessionPolicyForGroup(
  graph: OktaGraph,
  groupId: string,
): GlobalSessionPolicyNode | null {
  const applies = graph.edges.find((e) => e.kind === "appliesTo" && e.to === groupId);
  if (!applies) return null;
  return (
    graph.nodes.find(
      (n): n is GlobalSessionPolicyNode =>
        n.kind === "GlobalSessionPolicy" && n.id === applies.from,
    ) ?? null
  );
}

/** protects: AppAuthPolicy -> App. Absence of an edge => org default (null), NOT unprotected. */
export function authPolicyForApp(graph: OktaGraph, appId: string): AppAuthPolicyNode | null {
  const protects = graph.edges.find((e) => e.kind === "protects" && e.to === appId);
  if (!protects) return null;
  return (
    graph.nodes.find(
      (n): n is AppAuthPolicyNode => n.kind === "AppAuthPolicy" && n.id === protects.from,
    ) ?? null
  );
}

/** populates: GroupRule -> Group. Rules populating a given group, in edge order, deduped. */
function rulesPopulatingGroup(graph: OktaGraph, groupId: string): GroupRuleNode[] {
  const rules: GroupRuleNode[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "populates" || edge.to !== groupId || seen.has(edge.from)) continue;
    const rule = graph.nodes.find(
      (n): n is GroupRuleNode => n.kind === "GroupRule" && n.id === edge.from,
    );
    if (rule) {
      rules.push(rule);
      seen.add(edge.from);
    }
  }
  return rules;
}

/**
 * Trace a group's access. `groupNameOrId` matches a group id first, then a group
 * display name (exact). Throws if no group matches.
 */
export function trace(graph: OktaGraph, groupNameOrId: string): TraceResult {
  const groups = graph.nodes.filter((n): n is GroupNode => n.kind === "Group");
  const group =
    groups.find((g) => g.id === groupNameOrId) ??
    groups.find((g) => g.name === groupNameOrId);
  if (!group) {
    throw new Error(`Group not found: "${groupNameOrId}"`);
  }

  const apps = appsGrantedByGroup(graph, group.id);
  const globalSessionPolicy = sessionPolicyForGroup(graph, group.id);
  const appAuthPolicies: Record<string, AppAuthPolicyNode | null> = {};
  for (const app of apps) {
    appAuthPolicies[app.id] = authPolicyForApp(graph, app.id);
  }

  return { group, apps, globalSessionPolicy, appAuthPolicies };
}

/** The reverse of TraceResult: an app's inbound access — who reaches it and under what policy. */
export interface AppTraceResult {
  app: AppNode;
  /** Groups whose `grants` edge targets this app, in edge order (deduped). */
  grantingGroups: GroupNode[];
  /** Rules that populate any granting group (deduped) — how users land in those groups. */
  populatingRules: GroupRuleNode[];
  /** The app's auth policy, or null => org default app sign-on policy (NOT unprotected). */
  authPolicy: AppAuthPolicyNode | null;
}

/**
 * Trace an app's inbound access (the dual of `trace`). `appNameOrId` matches an app id first,
 * then a display name (exact). Throws if no app matches. Pure id matching, no OEL evaluation.
 */
export function traceApp(graph: OktaGraph, appNameOrId: string): AppTraceResult {
  const apps = graph.nodes.filter((n): n is AppNode => n.kind === "App");
  const app = apps.find((a) => a.id === appNameOrId) ?? apps.find((a) => a.name === appNameOrId);
  if (!app) {
    throw new Error(`App not found: "${appNameOrId}"`);
  }

  const grantingGroups = groupsGrantingApp(graph, app.id);

  // Rules feeding any granting group (deduped across all granting groups, edge order).
  const populatingRules: GroupRuleNode[] = [];
  const seenRule = new Set<string>();
  for (const group of grantingGroups) {
    for (const rule of rulesPopulatingGroup(graph, group.id)) {
      if (seenRule.has(rule.id)) continue;
      populatingRules.push(rule);
      seenRule.add(rule.id);
    }
  }

  const authPolicy = authPolicyForApp(graph, app.id);

  return { app, grantingGroups, populatingRules, authPolicy };
}

/** A user's identity for a trace. `login` (the email) is display-only; `id` is the join key. */
export interface UserRef {
  id: string;
  login: string;
}

/** One group the user belongs to, and what it grants them. */
export interface UserGroupAccess {
  group: GroupNode;
  /** Apps this group grants (grant order). */
  apps: AppNode[];
  /**
   * Rules that populate this group. Empty => no rule populates it (membership is direct or via
   * app-push). A non-empty list does NOT prove the user entered via that rule — Okta's
   * `/users/{id}/groups` doesn't expose per-user source, and rule expressions are never
   * evaluated here. The rules (and their raw expressions) are surfaced for a human to read.
   */
  populatingRules: GroupRuleNode[];
  /** The global session policy on this group, or null if none. */
  globalSessionPolicy: GlobalSessionPolicyNode | null;
}

/** The result of tracing one user's access — the union of what all their groups grant. */
export interface UserTraceResult {
  user: UserRef;
  /** Per-group breakdown, in the input (membership) order. */
  viaGroups: UserGroupAccess[];
  /** Deduped union of every app reachable across the user's groups, in name order. */
  apps: AppNode[];
  /**
   * Per-app app auth policy, keyed by app id. `null` => the app falls back to the org default
   * app sign-on policy (it is NOT unprotected).
   */
  appAuthPolicies: Record<string, AppAuthPolicyNode | null>;
  /**
   * Membership group ids absent from the graph — the user is in groups outside the
   * Terraform/live scope we loaded. Surfaced, never silently dropped.
   */
  unknownGroupIds: string[];
}

/**
 * Trace ONE user's access from their group memberships. PURE — the caller supplies the
 * membership (the live read that resolves email -> user -> group ids lives in `src/inputs`).
 * A user is a trace INPUT, never a graph node; this is what lets user trace stay pure and
 * scale to enterprise tenants (one user per lookup, no user nodes in the graph).
 */
export function traceUser(
  graph: OktaGraph,
  membership: { user: UserRef; groupIds: string[] },
): UserTraceResult {
  const viaGroups: UserGroupAccess[] = [];
  const unknownGroupIds: string[] = [];

  for (const groupId of membership.groupIds) {
    const group = graph.nodes.find((n): n is GroupNode => n.kind === "Group" && n.id === groupId);
    if (!group) {
      unknownGroupIds.push(groupId);
      continue;
    }
    viaGroups.push({
      group,
      apps: appsGrantedByGroup(graph, group.id),
      populatingRules: rulesPopulatingGroup(graph, group.id),
      globalSessionPolicy: sessionPolicyForGroup(graph, group.id),
    });
  }

  // Deduped union of apps across all the user's groups.
  const appById = new Map<string, AppNode>();
  for (const via of viaGroups) {
    for (const app of via.apps) {
      if (!appById.has(app.id)) appById.set(app.id, app);
    }
  }
  const apps = [...appById.values()].sort((a, b) => a.name.localeCompare(b.name));

  const appAuthPolicies: Record<string, AppAuthPolicyNode | null> = {};
  for (const app of apps) {
    appAuthPolicies[app.id] = authPolicyForApp(graph, app.id);
  }

  return { user: membership.user, viaGroups, apps, appAuthPolicies, unknownGroupIds };
}

/** One way a user reaches an app: the granting group, whether it's rule-populated, and its session gate. */
export interface UserAppPath {
  group: GroupNode;
  populatingRules: GroupRuleNode[];
  globalSessionPolicy: GlobalSessionPolicyNode | null;
}

/** Focused answer to "does this user reach THIS app, and why / why not?" */
export interface UserAppExplain {
  user: UserRef;
  app: AppNode;
  hasAccess: boolean;
  /** The paths (granting groups) by which the user reaches the app. Non-empty iff `hasAccess`. */
  paths: UserAppPath[];
  /** The app's auth gate, or null => org default app sign-on policy (NOT unprotected). */
  authPolicy: AppAuthPolicyNode | null;
  /**
   * When `!hasAccess`: the groups that DO grant this app (the user is in none of them). Empty
   * when `hasAccess`. This is the honest "why not" — no OEL is evaluated.
   */
  grantingGroups: GroupNode[];
  /**
   * When `!hasAccess`: rules populating those granting groups, surfaced with their raw
   * expressions so a human can read whether the rule would include this user. NOT evaluated.
   */
  governingRules: GroupRuleNode[];
}

/**
 * Explain one user's access to ONE app, from an already-computed `UserTraceResult`. Pure.
 * `appNameOrId` matches an app id first, then display name (exact). Throws if no app matches.
 * On no-access, surfaces the would-be granting groups + their governing rule expressions
 * (verbatim, never evaluated) so the absence is explained honestly.
 */
export function explainUserApp(
  graph: OktaGraph,
  result: UserTraceResult,
  appNameOrId: string,
): UserAppExplain {
  const apps = graph.nodes.filter((n): n is AppNode => n.kind === "App");
  const app = apps.find((a) => a.id === appNameOrId) ?? apps.find((a) => a.name === appNameOrId);
  if (!app) {
    throw new Error(`App not found: "${appNameOrId}"`);
  }

  const authPolicy = authPolicyForApp(graph, app.id);

  const paths: UserAppPath[] = [];
  for (const via of result.viaGroups) {
    if (via.apps.some((a) => a.id === app.id)) {
      paths.push({
        group: via.group,
        populatingRules: via.populatingRules,
        globalSessionPolicy: via.globalSessionPolicy,
      });
    }
  }

  if (paths.length > 0) {
    return { user: result.user, app, hasAccess: true, paths, authPolicy, grantingGroups: [], governingRules: [] };
  }

  // No access: explain which groups WOULD grant it, and the rules governing those groups.
  const grantingGroups = groupsGrantingApp(graph, app.id);
  const governingRules: GroupRuleNode[] = [];
  const seenRule = new Set<string>();
  for (const group of grantingGroups) {
    for (const rule of rulesPopulatingGroup(graph, group.id)) {
      if (seenRule.has(rule.id)) continue;
      governingRules.push(rule);
      seenRule.add(rule.id);
    }
  }
  return { user: result.user, app, hasAccess: false, paths, authPolicy, grantingGroups, governingRules };
}

/** Count nodes by kind, for the `summary` command. */
export function summarize(graph: OktaGraph): GraphSummary {
  const count = (kind: NodeKind): number =>
    graph.nodes.filter((n) => n.kind === kind).length;
  return {
    groups: count("Group"),
    apps: count("App"),
    groupRules: count("GroupRule"),
    globalSessionPolicies: count("GlobalSessionPolicy"),
    appAuthPolicies: count("AppAuthPolicy"),
  };
}
