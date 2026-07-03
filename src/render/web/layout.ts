/**
 * web/layout: a deterministic layout. PURE, DOM-free — no layout library (rail: fixture-scale
 * only). This is a HAND-ROLLED layout: it minimizes but cannot fully guarantee zero
 * edge-through-node overlaps for arbitrary tenants. A real layout engine (dagre/ELK) is the
 * robust general fix and is the pending decision if tenants get messier.
 *
 * Policies are gates that hang off a resource, not links in the resource-to-resource flow:
 *
 *   SESSION LANE:        [session policy]
 *                              | appliesTo (drops into the group below)
 *   SPINE:  [GroupRule] -> [Group] --grants--> [App] -- protects -- [App auth policy]
 *
 * The spine runs GroupRule -> Group -> App left-to-right. A global session policy sits in a lane
 * ABOVE its group (short vertical appliesTo edge). An app auth policy sits to the RIGHT of the
 * specific app it protects, on that app's ROW — so its `protects` edge is a short horizontal
 * line that never spans past a stacked app card (the crossing the top-lane placement caused).
 */

import type { GraphNode, NodeKind, OktaGraph } from "../../core/model.js";

export interface NodePosition {
  x: number;
  y: number;
}

type Lane = "policy" | "spine";

/** Spine column + lane for the kinds laid out by the column pass. AppAuthPolicy is placed
 * separately (row-aligned beside its app), so it's intentionally absent here. */
const PLACEMENT: Partial<Record<NodeKind, { column: number; lane: Lane }>> = {
  GroupRule: { column: 0, lane: "spine" },
  GlobalSessionPolicy: { column: 1, lane: "policy" },
  Group: { column: 1, lane: "spine" },
  App: { column: 2, lane: "spine" },
};

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 90;
const LANE_GAP = 60;
const TOP_MARGIN = 40;
const LEFT_MARGIN = 40;

export function layoutGraph(graph: OktaGraph): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();

  // --- Pass 1: spine (Rule/Group/App) + session-policy lane, by (lane, column) buckets. ---
  const buckets = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const cell = PLACEMENT[node.kind];
    if (!cell) continue; // AppAuthPolicy: placed in pass 2
    const k = `${cell.lane}:${cell.column}`;
    const bucket = buckets.get(k);
    if (bucket) bucket.push(node);
    else buckets.set(k, [node]);
  }

  // Spine starts below the tallest policy-lane column so the lanes never overlap.
  let policyRows = 0;
  for (const [k, nodes] of buckets) {
    if (k.startsWith("policy:")) policyRows = Math.max(policyRows, nodes.length);
  }
  const spineBaseY = policyRows > 0 ? TOP_MARGIN + policyRows * ROW_HEIGHT + LANE_GAP : TOP_MARGIN;

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

  // --- Pass 2: app auth policies, row-aligned to the RIGHT of the app they protect. ---
  const appOfPolicy = new Map<string, string>(); // policyId -> first app it protects
  for (const e of graph.edges) {
    if (e.kind === "protects" && !appOfPolicy.has(e.from)) appOfPolicy.set(e.from, e.to);
  }
  // Fallback stack for any app policy not resolved to an app (shouldn't happen for real data).
  let orphanRow = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "AppAuthPolicy") continue;
    const appPos = positions.get(appOfPolicy.get(node.id) ?? "");
    positions.set(
      node.id,
      appPos
        ? { x: appPos.x + COLUMN_WIDTH, y: appPos.y }
        : { x: LEFT_MARGIN + 3 * COLUMN_WIDTH, y: spineBaseY + orphanRow++ * ROW_HEIGHT },
    );
  }

  return positions;
}
