/**
 * web/derive-cards: turn the full OktaGraph into a "policies as attributes" view. PURE,
 * DOM-free — the transformation the M4 redesign hinges on.
 *
 * The two policy layers stop being NODES and become ATTRIBUTES of the resource they belong to
 * (a session policy is a property of its group; an app auth policy is a property of its app).
 * That leaves a clean rule -> group -> app DAG for the layout engine, and mirrors the domain
 * model exactly. Sharing (one policy governing many resources) is not lost — it's recovered on
 * demand via `resourcesByPolicy` (click a policy badge -> highlight every card it governs).
 *
 * Correctness rules preserved from the model: the two layers stay DISTINCT (session vs auth are
 * separate maps, never merged), and "no auth policy" means ORG DEFAULT, never unprotected — an
 * app simply absent from `authPolicyByApp` renders as "org default".
 */

import type {
  AppAuthPolicyNode,
  GlobalSessionPolicyNode,
  GraphNode,
  OktaGraph,
} from "../../core/model.js";

export interface CardModel {
  /** The graph the layout engine draws: only GroupRule/Group/App nodes + populates/grants edges. */
  flow: OktaGraph;
  /** groupId -> its global session policy. Absent = no session policy applies. */
  sessionPolicyByGroup: Map<string, GlobalSessionPolicyNode>;
  /** appId -> its app auth policy. Absent = org default app policy (NOT unprotected). */
  authPolicyByApp: Map<string, AppAuthPolicyNode>;
  /** policyId -> ids of the resources it governs (groups for session, apps for auth). For sharing. */
  resourcesByPolicy: Map<string, string[]>;
}

const FLOW_KINDS = new Set<GraphNode["kind"]>(["GroupRule", "Group", "App"]);

export function deriveCards(graph: OktaGraph): CardModel {
  const sessionPolicyNodes = new Map<string, GlobalSessionPolicyNode>();
  const authPolicyNodes = new Map<string, AppAuthPolicyNode>();
  for (const n of graph.nodes) {
    if (n.kind === "GlobalSessionPolicy") sessionPolicyNodes.set(n.id, n);
    else if (n.kind === "AppAuthPolicy") authPolicyNodes.set(n.id, n);
  }

  const flowNodes = graph.nodes.filter((n) => FLOW_KINDS.has(n.kind));
  const flowEdges = graph.edges.filter((e) => e.kind === "populates" || e.kind === "grants");

  const sessionPolicyByGroup = new Map<string, GlobalSessionPolicyNode>();
  const authPolicyByApp = new Map<string, AppAuthPolicyNode>();
  const resourcesByPolicy = new Map<string, string[]>();
  const addGoverned = (policyId: string, resourceId: string): void => {
    const list = resourcesByPolicy.get(policyId);
    if (list) list.push(resourceId);
    else resourcesByPolicy.set(policyId, [resourceId]);
  };

  for (const e of graph.edges) {
    if (e.kind === "appliesTo") {
      // appliesTo: GlobalSessionPolicy(from) -> Group(to)
      const policy = sessionPolicyNodes.get(e.from);
      if (policy) {
        if (!sessionPolicyByGroup.has(e.to)) sessionPolicyByGroup.set(e.to, policy);
        addGoverned(policy.id, e.to);
      }
    } else if (e.kind === "protects") {
      // protects: AppAuthPolicy(from) -> App(to)
      const policy = authPolicyNodes.get(e.from);
      if (policy) {
        if (!authPolicyByApp.has(e.to)) authPolicyByApp.set(e.to, policy);
        addGoverned(policy.id, e.to);
      }
    }
  }

  return {
    flow: { nodes: flowNodes, edges: flowEdges },
    sessionPolicyByGroup,
    authPolicyByApp,
    resourcesByPolicy,
  };
}
