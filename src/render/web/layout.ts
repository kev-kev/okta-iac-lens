/**
 * web/layout: a deterministic layered layout for the access graph. PURE, DOM-free — no
 * layout library (rail: fixture-scale only; auto-layout deferred until a real tenant needs it).
 *
 * Columns left -> right follow the access flow:
 *   GroupRule -> GlobalSessionPolicy -> Group -> AppAuthPolicy -> App
 * i.e. a rule populates a group, a session policy applies to a group, a group grants an app,
 * an app is protected by an app policy. Each policy column sits immediately UPSTREAM (left) of
 * what it gates, so every edge (populates/appliesTo/grants/protects) flows left->right with no
 * reversal — that keeps edge lines clean (no U-turn hooks). The two policy layers stay distinct
 * by color/label/legend, not by which side they're on.
 */

import type { GraphNode, NodeKind, OktaGraph } from "../../core/model.js";

export interface NodePosition {
  x: number;
  y: number;
}

/** Left-to-right column index per kind. */
const COLUMN: Record<NodeKind, number> = {
  GroupRule: 0,
  GlobalSessionPolicy: 1,
  Group: 2,
  AppAuthPolicy: 3,
  App: 4,
};

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 90;
const TOP_MARGIN = 40;
const LEFT_MARGIN = 40;

/**
 * Assign each node a position. Nodes are bucketed by kind (preserving graph order), then
 * stacked vertically within their column. Deterministic: same graph -> same positions.
 */
export function layoutGraph(graph: OktaGraph): Map<string, NodePosition> {
  const byColumn = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const col = COLUMN[node.kind];
    const bucket = byColumn.get(col);
    if (bucket) bucket.push(node);
    else byColumn.set(col, [node]);
  }

  const positions = new Map<string, NodePosition>();
  for (const [col, nodes] of byColumn) {
    nodes.forEach((node, row) => {
      positions.set(node.id, {
        x: LEFT_MARGIN + col * COLUMN_WIDTH,
        y: TOP_MARGIN + row * ROW_HEIGHT,
      });
    });
  }
  return positions;
}
