/**
 * build-graph: normalized resources -> the typed access graph.
 *
 * PURE. Wires edges by literal id matching only (M1). Each edge's direction follows
 * the model in model.ts. Note the two policy layers produce two DISTINCT edge kinds.
 */

import type { Edge, GraphNode, OktaGraph } from "./model.js";
import type { ParsedResource } from "./parse-tfstate.js";

export function buildGraph(resources: ParsedResource[]): OktaGraph {
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];

  for (const r of resources) {
    switch (r.kind) {
      case "Group":
        nodes.push({ kind: "Group", id: r.id, name: r.name, address: r.address });
        break;

      case "App":
        nodes.push({
          kind: "App",
          id: r.id,
          name: r.name,
          address: r.address,
          appType: r.appType,
          status: r.status,
        });
        // protects: AppAuthPolicy -> App. No policy id => app uses the org default (no edge).
        if (r.authenticationPolicyId) {
          edges.push({ kind: "protects", from: r.authenticationPolicyId, to: r.id });
        }
        break;

      case "GroupRule":
        nodes.push({
          kind: "GroupRule",
          id: r.id,
          name: r.name,
          address: r.address,
          expression: r.expression,
          expressionType: r.expressionType,
          status: r.status,
        });
        // populates: GroupRule -> Group (one edge per target group). An INACTIVE rule is not
        // evaluated by Okta and populates NO ONE — emit no edge (the node is kept, annotated
        // with its status, so coverage still sees the object). Absent status => ACTIVE.
        if (r.status !== "INACTIVE") {
          for (const groupId of r.populates) {
            edges.push({ kind: "populates", from: r.id, to: groupId });
          }
        }
        break;

      case "GlobalSessionPolicy":
        nodes.push({
          kind: "GlobalSessionPolicy",
          id: r.id,
          name: r.name,
          address: r.address,
          priority: r.priority,
          status: r.status,
        });
        // appliesTo: GlobalSessionPolicy -> Group (one edge per included group). Edges carry no
        // priority; the traversal reads priority off the policy node when choosing among them.
        for (const groupId of r.groupsIncluded) {
          edges.push({ kind: "appliesTo", from: r.id, to: groupId });
        }
        break;

      case "AppAuthPolicy":
        nodes.push({
          kind: "AppAuthPolicy",
          id: r.id,
          name: r.name,
          address: r.address,
          priority: r.priority,
          status: r.status,
        });
        break;

      case "AppGroupAssignment":
        // grants: Group -> App
        edges.push({ kind: "grants", from: r.groupId, to: r.appId });
        break;

      case "AppAccessPolicyAssignment":
        // protects: AppAuthPolicy -> App, via the standalone attachment resource (the second
        // path to a protects edge besides an app's inline `authentication_policy`).
        edges.push({ kind: "protects", from: r.policyId, to: r.appId });
        break;

      case "AppUserAssignment":
        // Individual user -> app assignment. NOT modeled in the graph (a user is never a node).
        // Counted elsewhere (coverage + summary notice); nothing to add here.
        break;
    }
  }

  return { nodes, edges };
}
