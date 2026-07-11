/**
 * The normalized Okta access graph.
 *
 * This module is PURE TYPES only — no I/O, no logic. It is the contract every
 * other core module agrees on: parse-tfstate produces resources, build-graph
 * produces this graph, access-paths traverses it.
 *
 * Design rule (see CLAUDE.md): Okta evaluates access through TWO separate policy
 * layers and this model keeps them distinct. Do not merge them into one "policy
 * gates thing" edge — that bakes in a real misconception.
 *
 *   1. GlobalSessionPolicy  — governs the user's SESSION into Okta. Assigned to GROUPS.
 *      (historically "Okta sign-on policy"; provider: okta_policy_signon)
 *   2. AppAuthPolicy        — governs access to a SPECIFIC APP. Attached to APPS.
 *      (app-level sign-on policy; provider: okta_app_signon_policy)
 *
 * A user's real access to an app is gated by BOTH layers.
 */

/** The kinds of node in the graph. */
export type NodeKind =
  | "Group"
  | "App"
  | "GroupRule"
  | "GlobalSessionPolicy"
  | "AppAuthPolicy";

/**
 * The kinds of directed edge in the graph. Each has exactly one meaning and one
 * (source kind -> target kind). Keeping the two policy edges separate is load-bearing.
 */
export type EdgeKind =
  | "populates" // GroupRule           -> Group   (okta_group_rule.group_assignments)
  | "grants" //    Group               -> App     (app-group assignment resources)
  | "appliesTo" //  GlobalSessionPolicy -> Group   (okta_policy_signon.groups_included; unordered set)
  | "protects"; //  AppAuthPolicy       -> App     (app.authentication_policy)
//
// `protects` note: the edge is derived from the APP's `authentication_policy`
// attribute. If an app has NO `protects` edge, that is not "unprotected" — it means
// the app falls back to the org's DEFAULT app sign-on policy (which we don't model as
// a resource in M1). So "no AppAuthPolicy" == "org default", never "no auth".
//
// `appliesTo` note: `groups_included` is an unordered set of group ids; edge order
// carries no meaning.

/** Fields every node shares. `id` is the Okta resource id — the join key for all edges. */
export interface BaseNode {
  /** Okta resource id (from tfstate `values.id`). The key that edges match on. */
  id: string;
  kind: NodeKind;
  /** Human-facing display name (Group: values.name; App: values.label; policies/rules: values.name). */
  name: string;
  /** Terraform resource address (e.g. "okta_group.engineering"). Provenance only. */
  address: string;
}

export interface GroupNode extends BaseNode {
  kind: "Group";
}

export interface AppNode extends BaseNode {
  kind: "App";
  /** The Terraform resource type the app came from, e.g. "okta_app_oauth" | "okta_app_saml". */
  appType: string;
  /**
   * Okta lifecycle status (`ACTIVE` | `INACTIVE`), from `values.status` (tfstate) or `app.status`
   * (live). Absent on the idealized fixtures → treat as ACTIVE. A DEACTIVATED app is unreachable;
   * M12 ANNOTATES (carries the field) but does not filter — coverage still needs the object.
   */
  status?: string;
}

export interface GroupRuleNode extends BaseNode {
  kind: "GroupRule";
  /**
   * The raw Okta Expression Language string, stored LITERALLY and never evaluated in M1.
   * (Evaluating it to resolve hypothetical user membership is explicitly deferred.)
   */
  expression: string;
  /** e.g. "urn:okta:expression:1.0". */
  expressionType?: string;
  /**
   * Okta lifecycle status (`ACTIVE` | `INACTIVE`). Absent → ACTIVE. An INACTIVE rule is not
   * evaluated by Okta and populates NO ONE — build-graph emits no `populates` edge for it, but
   * the node is kept (annotate, not filter) so coverage still sees the object.
   */
  status?: string;
}

export interface GlobalSessionPolicyNode extends BaseNode {
  kind: "GlobalSessionPolicy";
  /**
   * Evaluation priority (lower number = evaluated first). From `values.priority`. Absent → sorts
   * LAST (Okta "API defaults to last/lowest if absent"). Traversal picks the lowest-priority
   * ACTIVE policy that applies to a group.
   */
  priority?: number;
  /** Okta lifecycle status (`ACTIVE` | `INACTIVE`). Absent → ACTIVE. INACTIVE policies are skipped. */
  status?: string;
}

export interface AppAuthPolicyNode extends BaseNode {
  kind: "AppAuthPolicy";
  /** Evaluation priority (lower = first). Carried for M15 rule ordering; unused by M12 traversal. */
  priority?: number;
  /** Okta lifecycle status (`ACTIVE` | `INACTIVE`). Absent → ACTIVE. */
  status?: string;
}

export type GraphNode =
  | GroupNode
  | AppNode
  | GroupRuleNode
  | GlobalSessionPolicyNode
  | AppAuthPolicyNode;

/** A directed edge between two node ids. */
export interface Edge {
  kind: EdgeKind;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
}

/**
 * The whole graph as plain, serializable data (arrays, not Maps) so it is trivial
 * to snapshot in tests. Lookups/indexes are built by traversal code as needed.
 */
export interface OktaGraph {
  nodes: GraphNode[];
  edges: Edge[];
}
