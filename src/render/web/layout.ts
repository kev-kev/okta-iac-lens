/**
 * web/layout: layered graph layout via dagre. PURE, DOM-free.
 *
 * The hand-rolled column layout is gone — dagre (the Sugiyama layered-DAG algorithm) assigns
 * ranks, orders nodes to minimize crossings, and spaces them so edges route through gaps
 * rather than through cards. It operates on the FLOW graph only (rule -> group -> app); policies
 * are card attributes now (see derive-cards.ts), so there are no policy nodes/edges to route.
 * dagre is deterministic for a given input, so the layout is stable across runs.
 */

import dagre from "@dagrejs/dagre";
import type { OktaGraph } from "../../core/model.js";

export interface NodePosition {
  x: number;
  y: number;
}

/** Card size dagre reserves per node (must roughly match the rendered card box). */
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 84;

/**
 * Lay out the flow graph left-to-right. Returns top-left positions keyed by node id (dagre
 * reports node centers; React Flow wants top-left, so we shift by half the box).
 */
export function layoutGraph(flow: OktaGraph): Map<string, NodePosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 44, ranksep: 110, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of flow.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of flow.edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const positions = new Map<string, NodePosition>();
  for (const node of flow.nodes) {
    const laid = g.node(node.id);
    positions.set(node.id, {
      x: laid.x - NODE_WIDTH / 2,
      y: laid.y - NODE_HEIGHT / 2,
    });
  }
  return positions;
}
