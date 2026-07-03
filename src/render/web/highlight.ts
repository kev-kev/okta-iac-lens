/**
 * web/highlight: map a selection to the set of node + edge ids to light up. PURE, DOM-free.
 *
 * Two selection modes, both details-on-demand over the same canvas:
 *  - a traced GROUP: highlight the group and the apps it grants (built on the imported core
 *    `trace()`, so it can't drift from CLI semantics);
 *  - a selected POLICY badge: highlight every resource that policy governs (sharing view).
 * Policies are attributes now, so neither mode highlights policy nodes — there are none.
 */

import type { Edge } from "../../core/model.js";
import type { TraceResult } from "../../core/access-paths.js";
import type { CardModel } from "./derive-cards.js";

/** React Flow edge id: `${kind}:${from}:${to}` — matches the M2 equivalence-test sort key. */
export function edgeId(edge: Pick<Edge, "kind" | "from" | "to">): string {
  return `${edge.kind}:${edge.from}:${edge.to}`;
}

export interface HighlightSet {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/** A traced group: the group card, the apps it grants, and the grants edges between them. */
export function highlightForTrace(result: TraceResult): HighlightSet {
  const nodeIds = new Set<string>([result.group.id]);
  const edgeIds = new Set<string>();
  for (const app of result.apps) {
    nodeIds.add(app.id);
    edgeIds.add(edgeId({ kind: "grants", from: result.group.id, to: app.id }));
  }
  return { nodeIds, edgeIds };
}

/** A selected policy: every resource card it governs (its sharing footprint). No edges. */
export function highlightForPolicy(cards: CardModel, policyId: string): HighlightSet {
  return {
    nodeIds: new Set<string>(cards.resourcesByPolicy.get(policyId) ?? []),
    edgeIds: new Set<string>(),
  };
}
