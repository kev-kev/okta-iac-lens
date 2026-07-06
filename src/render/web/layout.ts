/**
 * web/layout: layered graph layout via dagre. PURE, DOM-free.
 *
 * The hand-rolled column layout is gone — dagre (the Sugiyama layered-DAG algorithm) assigns
 * ranks, orders nodes to minimize crossings, and spaces them so edges route through gaps
 * rather than through cards. It operates on the FLOW graph only (rule -> group -> app); policies
 * are card attributes now (see derive-cards.ts), so there are no policy nodes/edges to route.
 * Focus-view "+N more" aggregates are laid out AS dagre nodes (leaves hanging off their host),
 * so they get real, non-overlapping positions instead of a hand-tuned offset.
 * dagre is deterministic for a given input, so the layout is stable across runs.
 */

import dagre from "@dagrejs/dagre";
import type { NodeKind, OktaGraph } from "../../core/model.js";
import type { AggregateNode } from "./build-focus-view.js";
import { aggregateSide } from "./build-focus-view.js";

export interface NodePosition {
  x: number;
  y: number;
}

/** Card size dagre reserves per node (must roughly match the rendered card box). */
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 84;
/** "+N more" aggregate pill size. */
export const AGG_WIDTH = 110;
export const AGG_HEIGHT = 34;

export interface LayoutSpacing {
  nodesep: number;
  ranksep: number;
}
/** Full-canvas spacing (M4/M5). */
export const DEFAULT_SPACING: LayoutSpacing = { nodesep: 44, ranksep: 110 };
/** Tighter spacing for bounded focus views, so a rank of neighbors packs into the viewport. */
export const COMPACT_SPACING: LayoutSpacing = { nodesep: 28, ranksep: 90 };

/**
 * Lay out the flow graph (plus any focus-view aggregates) left-to-right. Returns top-left
 * positions keyed by node/aggregate id (dagre reports centers; React Flow wants top-left).
 */
export function layoutGraph(
  flow: OktaGraph,
  aggregates: AggregateNode[] = [],
  spacing: LayoutSpacing = DEFAULT_SPACING,
): Map<string, NodePosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: spacing.nodesep,
    ranksep: spacing.ranksep,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const size = new Map<string, { width: number; height: number }>();
  for (const node of flow.nodes) {
    size.set(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const agg of aggregates) {
    size.set(agg.id, { width: AGG_WIDTH, height: AGG_HEIGHT });
    g.setNode(agg.id, { width: AGG_WIDTH, height: AGG_HEIGHT });
  }
  for (const edge of flow.edges) {
    g.setEdge(edge.from, edge.to);
  }
  const kindById = new Map<string, NodeKind>(flow.nodes.map((n) => [n.id, n.kind]));
  for (const agg of aggregates) {
    // Rank the pill on the correct side of its host: upstream neighbor kinds left, else right.
    const hostKind = kindById.get(agg.hostId);
    const side = hostKind ? aggregateSide(hostKind, agg.kind) : "right";
    if (side === "left") g.setEdge(agg.id, agg.hostId);
    else g.setEdge(agg.hostId, agg.id);
  }

  dagre.layout(g);

  const positions = new Map<string, NodePosition>();
  for (const [id, dim] of size) {
    const laid = g.node(id);
    positions.set(id, { x: laid.x - dim.width / 2, y: laid.y - dim.height / 2 });
  }
  return positions;
}
