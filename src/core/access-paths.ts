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
