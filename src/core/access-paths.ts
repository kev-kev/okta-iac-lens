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

  // grants: Group -> App. Preserve grant order; dedupe if a group is assigned twice.
  const apps: AppNode[] = [];
  const seenApp = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "grants" || edge.from !== group.id || seenApp.has(edge.to)) continue;
    const app = graph.nodes.find((n): n is AppNode => n.kind === "App" && n.id === edge.to);
    if (app) {
      apps.push(app);
      seenApp.add(edge.to);
    }
  }

  // appliesTo: GlobalSessionPolicy -> Group. At most one applies in the model; take the first.
  let globalSessionPolicy: GlobalSessionPolicyNode | null = null;
  const applies = graph.edges.find((e) => e.kind === "appliesTo" && e.to === group.id);
  if (applies) {
    globalSessionPolicy =
      graph.nodes.find(
        (n): n is GlobalSessionPolicyNode =>
          n.kind === "GlobalSessionPolicy" && n.id === applies.from,
      ) ?? null;
  }

  // protects: AppAuthPolicy -> App. Absence of an edge => org default (null).
  const appAuthPolicies: Record<string, AppAuthPolicyNode | null> = {};
  for (const app of apps) {
    const protects = graph.edges.find((e) => e.kind === "protects" && e.to === app.id);
    appAuthPolicies[app.id] = protects
      ? (graph.nodes.find(
          (n): n is AppAuthPolicyNode =>
            n.kind === "AppAuthPolicy" && n.id === protects.from,
        ) ?? null)
      : null;
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

  // grants: Group -> App. Collect the granting groups (edge order, deduped).
  const grantingGroups: GroupNode[] = [];
  const seenGroup = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "grants" || edge.to !== app.id || seenGroup.has(edge.from)) continue;
    const group = graph.nodes.find((n): n is GroupNode => n.kind === "Group" && n.id === edge.from);
    if (group) {
      grantingGroups.push(group);
      seenGroup.add(edge.from);
    }
  }

  // populates: GroupRule -> Group. Rules feeding any granting group (deduped).
  const populatingRules: GroupRuleNode[] = [];
  const seenRule = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "populates" || !seenGroup.has(edge.to) || seenRule.has(edge.from)) continue;
    const rule = graph.nodes.find(
      (n): n is GroupRuleNode => n.kind === "GroupRule" && n.id === edge.from,
    );
    if (rule) {
      populatingRules.push(rule);
      seenRule.add(edge.from);
    }
  }

  // protects: AppAuthPolicy -> App. Absence => org default (null).
  const protects = graph.edges.find((e) => e.kind === "protects" && e.to === app.id);
  const authPolicy = protects
    ? (graph.nodes.find(
        (n): n is AppAuthPolicyNode => n.kind === "AppAuthPolicy" && n.id === protects.from,
      ) ?? null)
    : null;

  return { app, grantingGroups, populatingRules, authPolicy };
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
