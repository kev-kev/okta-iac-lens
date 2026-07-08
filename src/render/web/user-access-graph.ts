/**
 * Build the sub-graph of ONE user's access, for rendering on the canvas: their groups, the apps
 * those groups grant, and the policies/rules attached to them — nothing else. Feeding this through
 * the existing `deriveCards` + `GraphView` renders the user's slice of the tenant exactly like the
 * whole-graph view (rules → groups → apps, policy badges on cards), but scoped to one person.
 *
 * PURE. A user is never a node; this is a filtered view of the real graph, keyed off the trace.
 */

import type { OktaGraph } from "../../core/model.js";
import type { UserTraceResult } from "../../core/access-paths.js";

export function buildUserAccessGraph(graph: OktaGraph, result: UserTraceResult): OktaGraph {
  const groupIds = new Set(result.viaGroups.map((v) => v.group.id));
  const appIds = new Set(result.apps.map((a) => a.id));
  const keep = new Set<string>([...groupIds, ...appIds]);

  // Pull in the policies gating those groups/apps and the rules populating those groups.
  for (const e of graph.edges) {
    if (e.kind === "appliesTo" && groupIds.has(e.to)) keep.add(e.from); // session policy → group
    else if (e.kind === "protects" && appIds.has(e.to)) keep.add(e.from); // auth policy → app
    else if (e.kind === "populates" && groupIds.has(e.to)) keep.add(e.from); // rule → group
  }

  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => {
    if (!keep.has(e.from) || !keep.has(e.to)) return false;
    // Only the user's OWN grant paths — an app granted by some other (non-member) group doesn't
    // belong in this user's picture.
    if (e.kind === "grants" && !groupIds.has(e.from)) return false;
    return true;
  });

  return { nodes, edges };
}
