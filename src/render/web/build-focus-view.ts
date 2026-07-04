/**
 * web/build-focus-view: turn one or more focus nodes into a BOUNDED subgraph the canvas can
 * render legibly, no matter how large the org is. PURE, DOM-free.
 *
 * This is the mechanism behind "no canvas render depends on org size" (CLAUDE.md scale strategy):
 *  - multi-source BFS outward from the foci over the flow adjacency;
 *  - a per-node HUB CAP (`hubK`): an expanded node admits at most k individual neighbors, so an
 *    "All Employees" group granting 800 apps never explodes the view;
 *  - a global visible-node BUDGET;
 *  - each visible node whose neighbors were truncated gets ONE aggregate ("N more") summary,
 *    so the fan-out is visible as a single browsable node instead of silently dropped.
 * At equal reach, UNMANAGED neighbors are admitted first (the coverage gap is what you're hunting).
 *
 * Returns a real `OktaGraph` (consumable by the existing layout/deriveCards/GraphView pipeline)
 * plus a separate `aggregates` list the UI renders as special nodes.
 */

import type { OktaGraph } from "../../core/model.js";
import type { CoverageBucket } from "../../analysis/coverage.js";
import type { GraphIndexes } from "./indexes.js";

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
}

export interface FocusOptions {
  /** Max real visible nodes. Default 150. */
  budget?: number;
  /** Max individual neighbors an expanded node admits before the rest aggregate. Default 12. */
  hubK?: number;
  /** Coverage buckets — `unmanaged` nodes are preferentially retained at equal reach. */
  bucketByNodeId?: Map<string, CoverageBucket>;
}

export function buildFocusView(
  graph: OktaGraph,
  indexes: GraphIndexes,
  foci: string[],
  options: FocusOptions = {},
): FocusView {
  const budget = options.budget ?? 150;
  const hubK = options.hubK ?? 12;
  const bucket = options.bucketByNodeId;
  // Lower sort key = admitted first: unmanaged before others, then id for determinism.
  const rank = (id: string): number => (bucket?.get(id) === "unmanaged" ? 0 : 1);

  const visible = new Set<string>();
  const queue: string[] = [];
  for (const id of foci) {
    if (indexes.nodeById.has(id) && !visible.has(id) && visible.size < budget) {
      visible.add(id);
      queue.push(id);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    if (visible.size >= budget) break;
    const id = queue[head];
    const neighborIds = (indexes.neighbors.get(id) ?? [])
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    let admitted = 0;
    for (const nb of neighborIds) {
      if (visible.has(nb)) continue; // already in via another path — free
      if (admitted >= hubK || visible.size >= budget) break; // rest of this node's fan-out aggregates
      visible.add(nb);
      queue.push(nb);
      admitted++;
    }
  }

  const nodes = graph.nodes.filter((n) => visible.has(n.id));
  const edges = graph.edges.filter(
    (e) =>
      (e.kind === "populates" || e.kind === "grants") &&
      visible.has(e.from) &&
      visible.has(e.to),
  );

  // A visible node with any neighbor NOT in the view gets one aggregate summarizing the remainder.
  const aggregates: AggregateNode[] = [];
  for (const id of visible) {
    let hidden = 0;
    for (const nb of indexes.neighbors.get(id) ?? []) {
      if (!visible.has(nb)) hidden++;
    }
    if (hidden > 0) aggregates.push({ id: `agg:${id}`, hostId: id, hiddenCount: hidden });
  }
  aggregates.sort((a, b) => a.hostId.localeCompare(b.hostId));

  return { graph: { nodes, edges }, aggregates, truncated: aggregates.length > 0 };
}
