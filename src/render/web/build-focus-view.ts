/**
 * web/build-focus-view: turn one or more focus nodes into a BOUNDED, TRACE-SHAPED subgraph the
 * canvas can render legibly, no matter how large the org is. PURE, DOM-free.
 *
 * This is the mechanism behind "no canvas render depends on org size" (CLAUDE.md scale strategy):
 *  - DEPTH-LIMITED expansion from the foci over the flow adjacency: the focus admits up to
 *    `hubK` direct neighbors; each depth-1 node admits up to `neighborK`; depth-2 nodes are
 *    frontier (admit nothing). The view answers "what does THIS node reach" — it must never
 *    flood the budget with nodes three hops away through a hub (the original design flaw:
 *    focusing a group pulled in ~140 sibling groups of a hub app, pure noise).
 *  - a global visible-node BUDGET as the hard cap;
 *  - "N more" AGGREGATES only on the focus and its direct neighbors (where they're actionable),
 *    each backed by a browsable list — truncation is visible, never silent.
 * At equal reach, UNMANAGED neighbors are admitted first (the coverage gap is what you're hunting).
 *
 * Returns a real `OktaGraph` (consumable by the existing layout/deriveCards/GraphView pipeline)
 * plus a separate `aggregates` list the UI renders as special nodes.
 */

import type { OktaGraph } from "../../core/model.js";
import type { CoverageBucket } from "../../analysis/coverage.js";
import type { GraphIndexes } from "./indexes.js";

/** Above this many nodes the viewer switches from full-canvas to query-first (CLAUDE.md scale). */
export const AUTO_THRESHOLD = 300;
/** Default max real visible nodes in a focus view (hard cap). */
export const FOCUS_BUDGET = 150;
/** Max direct neighbors the FOCUS admits before the rest aggregate. */
export const HUB_K = 12;
/** Max neighbors a depth-1 node admits (context, not flooding). Depth-2 admits none. */
export const NEIGHBOR_K = 4;

export interface AggregateNode {
  /** Synthetic id, `agg:<hostId>`. */
  id: string;
  /** The visible node this aggregate hangs off. */
  hostId: string;
  /** How many of the host's neighbors were truncated into this summary. */
  hiddenCount: number;
}

export interface FocusView {
  /** The bounded REAL subgraph — real nodes + flow edges, drop-in for the existing pipeline. */
  graph: OktaGraph;
  /** One "N more" summary per hub whose fan-out was truncated (sorted by host id). */
  aggregates: AggregateNode[];
  /** True if anything was omitted (a hub cap or the budget was hit). */
  truncated: boolean;
  /** BFS depth per visible node (focus = 0). Lets the UI emphasize near context, dim the frontier. */
  depthById: Map<string, number>;
}

export interface FocusOptions {
  /** Max real visible nodes (hard cap). Default 150. */
  budget?: number;
  /** Max direct neighbors the focus admits before the rest aggregate. Default 12. */
  hubK?: number;
  /** Max neighbors a depth-1 node admits. Depth-2 nodes admit none. Default 4. */
  neighborK?: number;
  /** Coverage buckets — `unmanaged` nodes are preferentially admitted at equal reach. */
  bucketByNodeId?: Map<string, CoverageBucket>;
}

export function buildFocusView(
  graph: OktaGraph,
  indexes: GraphIndexes,
  foci: string[],
  options: FocusOptions = {},
): FocusView {
  const budget = options.budget ?? FOCUS_BUDGET;
  const hubK = options.hubK ?? HUB_K;
  const neighborK = options.neighborK ?? NEIGHBOR_K;
  const bucket = options.bucketByNodeId;
  // Lower sort key = admitted first: unmanaged before others, then id for determinism.
  const rank = (id: string): number => (bucket?.get(id) === "unmanaged" ? 0 : 1);
  /** How many neighbors a node at this depth may admit. Depth ≥ 2 is frontier. */
  const capAtDepth = (depth: number): number => (depth === 0 ? hubK : depth === 1 ? neighborK : 0);

  const depthOf = new Map<string, number>(); // visible set, with BFS depth
  const queue: string[] = [];
  for (const id of foci) {
    if (indexes.nodeById.has(id) && !depthOf.has(id) && depthOf.size < budget) {
      depthOf.set(id, 0);
      queue.push(id);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    if (depthOf.size >= budget) break;
    const id = queue[head];
    const cap = capAtDepth(depthOf.get(id) ?? 0);
    if (cap === 0) continue; // frontier: its unexpanded fan-out is NOT this view's story
    const neighborIds = (indexes.neighbors.get(id) ?? [])
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    let admitted = 0;
    for (const nb of neighborIds) {
      if (depthOf.has(nb)) continue; // already in via another path — free
      if (admitted >= cap || depthOf.size >= budget) break; // remainder aggregates
      depthOf.set(nb, (depthOf.get(id) ?? 0) + 1);
      queue.push(nb);
      admitted++;
    }
  }

  const nodes = graph.nodes.filter((n) => depthOf.has(n.id));
  const edges = graph.edges.filter(
    (e) =>
      (e.kind === "populates" || e.kind === "grants") &&
      depthOf.has(e.from) &&
      depthOf.has(e.to),
  );

  // Aggregates ONLY where they're actionable: the focus and its direct neighbors. A deeper
  // frontier node's unexpanded fan-out is expected, not signal — pills there are pure noise.
  const aggregates: AggregateNode[] = [];
  for (const [id, depth] of depthOf) {
    if (depth > 1) continue;
    let hidden = 0;
    for (const nb of indexes.neighbors.get(id) ?? []) {
      if (!depthOf.has(nb)) hidden++;
    }
    if (hidden > 0) aggregates.push({ id: `agg:${id}`, hostId: id, hiddenCount: hidden });
  }
  aggregates.sort((a, b) => a.hostId.localeCompare(b.hostId));

  return { graph: { nodes, edges }, aggregates, truncated: aggregates.length > 0, depthById: depthOf };
}

/** The neighbors of `hostId` NOT shown in the given focus view — what its "+N more" stands for.
 * PURE; used by the hidden-neighbors panel (aggregate click → browsable list, per the plan). */
export function hiddenNeighbors(view: FocusView, indexes: GraphIndexes, hostId: string): string[] {
  const visible = new Set(view.graph.nodes.map((n) => n.id));
  return (indexes.neighbors.get(hostId) ?? []).filter((id) => !visible.has(id)).sort();
}
