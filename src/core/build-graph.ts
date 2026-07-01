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
        });
        // populates: GroupRule -> Group (one edge per target group)
        for (const groupId of r.populates) {
          edges.push({ kind: "populates", from: r.id, to: groupId });
        }
        break;

      case "GlobalSessionPolicy":
        nodes.push({
          kind: "GlobalSessionPolicy",
          id: r.id,
          name: r.name,
          address: r.address,
        });
        // appliesTo: GlobalSessionPolicy -> Group (one edge per included group)
        for (const groupId of r.groupsIncluded) {
          edges.push({ kind: "appliesTo", from: r.id, to: groupId });
        }
        break;

      case "AppAuthPolicy":
        nodes.push({ kind: "AppAuthPolicy", id: r.id, name: r.name, address: r.address });
        break;

      case "AppGroupAssignment":
        // grants: Group -> App
        edges.push({ kind: "grants", from: r.groupId, to: r.appId });
        break;
    }
  }

  return { nodes, edges };
}
