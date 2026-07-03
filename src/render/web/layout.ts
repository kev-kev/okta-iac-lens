/**
 * web/layout: a deterministic two-lane layout. PURE, DOM-free — no layout library (rail:
 * fixture-scale only; auto-layout deferred until a real tenant needs it).
 *
 * The graph has a resource SPINE and a POLICY LANE, because policies are gates that hang off
 * a resource, not links in the resource-to-resource flow:
 *
 *   POLICY LANE (top):   [session policy]      [app auth policy]
 *                              | appliesTo            | protects
 *   SPINE (below):  [GroupRule] -> [Group] -----------------> [App]
 *                                        \--- grants --------/
 *
 * The spine runs GroupRule -> Group -> App left-to-right (populates, grants). Each policy sits
 * in the lane ABOVE the resource column it gates — a global session policy above its group, an
 * app auth policy above its app — linked by a short vertical edge (appliesTo / protects). This
 * keeps the spine uncluttered (no policy sits on the Rule->Group path), makes the two policy
 * layers legible as gates rather than flow-nodes, and shows a shared policy as one card with
 * several vertical edges.
 */

import type { GraphNode, NodeKind, OktaGraph } from "../../core/model.js";

export interface NodePosition {
  x: number;
  y: number;
}

type Lane = "policy" | "spine";

/** Which spine column each kind sits in, and which vertical lane. Policies share their gated
 * resource's column (session→Group column, app auth→App column) but live in the top lane. */
const PLACEMENT: Record<NodeKind, { column: number; lane: Lane }> = {
  GroupRule: { column: 0, lane: "spine" },
  Group: { column: 1, lane: "spine" },
  GlobalSessionPolicy: { column: 1, lane: "policy" },
  App: { column: 2, lane: "spine" },
  AppAuthPolicy: { column: 2, lane: "policy" },
};

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 90;
const LANE_GAP = 60;
const TOP_MARGIN = 40;
const LEFT_MARGIN = 40;

/**
 * Assign each node a position. Nodes are bucketed by (lane, column) preserving graph order,
 * then stacked vertically within their cell. The spine lane starts below the policy lane so
 * the two never overlap. Deterministic: same graph -> same positions.
 */
export function layoutGraph(graph: OktaGraph): Map<string, NodePosition> {
  const buckets = new Map<string, GraphNode[]>();
  const keyOf = (lane: Lane, column: number): string => `${lane}:${column}`;
  for (const node of graph.nodes) {
    const { lane, column } = PLACEMENT[node.kind];
    const k = keyOf(lane, column);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(node);
    else buckets.set(k, [node]);
  }

  // The spine lane starts below the tallest policy-lane column (or at the top if no policies).
  let policyRows = 0;
  for (const [k, nodes] of buckets) {
    if (k.startsWith("policy:")) policyRows = Math.max(policyRows, nodes.length);
  }
  const spineBaseY = policyRows > 0 ? TOP_MARGIN + policyRows * ROW_HEIGHT + LANE_GAP : TOP_MARGIN;

  const positions = new Map<string, NodePosition>();
  for (const [k, nodes] of buckets) {
    const [lane, columnStr] = k.split(":");
    const column = Number(columnStr);
    const baseY = lane === "policy" ? TOP_MARGIN : spineBaseY;
    nodes.forEach((node, row) => {
      positions.set(node.id, {
        x: LEFT_MARGIN + column * COLUMN_WIDTH,
        y: baseY + row * ROW_HEIGHT,
      });
    });
  }
  return positions;
}
