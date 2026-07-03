/**
 * web/highlight: map a `trace()` result to the set of node + edge ids to light up. PURE,
 * DOM-free. Built ON the imported core `trace()` output — NOT re-derived from raw edges — so
 * the viewer's highlight and the CLI's trace can never disagree (that identity is the point
 * of importing the pure core into the browser).
 */

import type { Edge } from "../../core/model.js";
import type { TraceResult } from "../../core/access-paths.js";

/** React Flow edge id: `${kind}:${from}:${to}` — matches the M2 equivalence-test sort key. */
export function edgeId(edge: Pick<Edge, "kind" | "from" | "to">): string {
  return `${edge.kind}:${edge.from}:${edge.to}`;
}

export interface HighlightSet {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/**
 * The highlight for a traced group: the group, its granted apps, its (single) session policy,
 * and each app's non-default auth policy — plus exactly the grants/appliesTo/protects edges
 * between them. An app on the org-default app policy contributes no protects edge (the
 * absence semantic, carried over from the model — "no policy" == org default, not unprotected).
 */
export function highlightForTrace(result: TraceResult): HighlightSet {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const groupId = result.group.id;
  nodeIds.add(groupId);

  if (result.globalSessionPolicy) {
    nodeIds.add(result.globalSessionPolicy.id);
    edgeIds.add(edgeId({ kind: "appliesTo", from: result.globalSessionPolicy.id, to: groupId }));
  }

  for (const app of result.apps) {
    nodeIds.add(app.id);
    edgeIds.add(edgeId({ kind: "grants", from: groupId, to: app.id }));

    const policy = result.appAuthPolicies[app.id];
    if (policy) {
      nodeIds.add(policy.id);
      edgeIds.add(edgeId({ kind: "protects", from: policy.id, to: app.id }));
    }
  }

  return { nodeIds, edgeIds };
}
