/**
 * web/build-focus-view: turn a focus node into its DEPTH-1 EGO VIEW — the focus plus ONLY its
 * direct neighbors. PURE, DOM-free.
 *
 * Why depth-1 (design revision 2, 2026-07-06): a depth-2 walk answered the wrong question —
 * focusing a group pulled in its apps' sibling groups (two hops away), producing spaghetti and
 * pushing the actual apps off-screen. The view now answers exactly "what does THIS node directly
 * connect to": for a group, the rules that populate it and the apps it grants; for an app, the
 * groups that grant it; for a rule, the groups it populates. You walk the graph by clicking a
 * neighbor to re-focus — never by rendering two hops at once.
 *
 * Neighbors are partitioned BY KIND and each kind is capped at `perSideCap` (unmanaged-first, so
 * coverage gaps stay visible); the remainder of a kind becomes ONE typed "+X more <kind>"
 * aggregate the UI renders as a pill → browsable panel. `perSideCap` is viewport-adaptive
 * (computed by the UI from canvas height), so the neighbor column always fits comfortably.
 *
 * Returns a real `OktaGraph` (drop-in for the existing layout/deriveCards/GraphView pipeline)
 * plus the `aggregates` list.
 */

import type { NodeKind, OktaGraph } from "../../core/model.js";
import type { CoverageBucket } from "../../analysis/coverage.js";
import type { GraphIndexes } from "./indexes.js";

/** Above this many nodes the viewer switches from full-canvas to query-first (CLAUDE.md scale). */
export const AUTO_THRESHOLD = 300;
/** Default per-kind neighbor cap (the UI overrides with a viewport-adaptive value, clamped below). */
export const PER_SIDE_CAP = 10;
/** Clamp bounds for the viewport-adaptive cap. */
export const MIN_PER_SIDE = 6;
export const MAX_PER_SIDE = 14;

export interface AggregateNode {
  /** Synthetic id, `agg:<hostId>:<kind>`. */
  id: string;
  /** The focus node this aggregate hangs off. */
  hostId: string;
  /** The kind of neighbor being summarized (for the "+N more apps" label). */
  kind: NodeKind;
  /** How many neighbors of this kind were truncated into the summary. */
  hiddenCount: number;
}

export interface FocusView {
  /** The depth-1 REAL subgraph — real nodes + flow edges, drop-in for the existing pipeline. */
  graph: OktaGraph;
  /** One typed "+N more <kind>" summary per truncated neighbor kind (sorted by kind). */
  aggregates: AggregateNode[];
  /** True if any neighbor kind was truncated. */
  truncated: boolean;
}

export interface FocusOptions {
  /** Max neighbors admitted per kind before the rest aggregate. Default PER_SIDE_CAP. */
  perSideCap?: number;
  /** Coverage buckets — `unmanaged` neighbors are admitted first (gaps stay visible). */
  bucketByNodeId?: Map<string, CoverageBucket>;
}

export function buildFocusView(
  graph: OktaGraph,
  indexes: GraphIndexes,
  foci: string[],
  options: FocusOptions = {},
): FocusView {
  const cap = options.perSideCap ?? PER_SIDE_CAP;
  const bucket = options.bucketByNodeId;
  const rank = (id: string): number => (bucket?.get(id) === "unmanaged" ? 0 : 1);

  const visible = new Set<string>();
  for (const id of foci) if (indexes.nodeById.has(id)) visible.add(id);

  const aggregates: AggregateNode[] = [];

  for (const focusId of foci) {
    if (!indexes.nodeById.has(focusId)) continue;
    // Partition this focus's direct neighbors by node kind.
    const byKind = new Map<NodeKind, string[]>();
    for (const nb of indexes.neighbors.get(focusId) ?? []) {
      const node = indexes.nodeById.get(nb);
      if (!node) continue;
      const list = byKind.get(node.kind);
      if (list) list.push(nb);
      else byKind.set(node.kind, [nb]);
    }
    // Admit up to `cap` per kind (unmanaged-first, then deterministic); rest -> one typed pill.
    for (const [kind, ids] of byKind) {
      ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      let admitted = 0;
      for (const nb of ids) {
        if (admitted >= cap) break;
        visible.add(nb);
        admitted++;
      }
      const hidden = ids.length - admitted;
      if (hidden > 0) {
        aggregates.push({ id: `agg:${focusId}:${kind}`, hostId: focusId, kind, hiddenCount: hidden });
      }
    }
  }

  const nodes = graph.nodes.filter((n) => visible.has(n.id));
  const edges = graph.edges.filter(
    (e) =>
      (e.kind === "populates" || e.kind === "grants") && visible.has(e.from) && visible.has(e.to),
  );
  aggregates.sort((a, b) => a.hostId.localeCompare(b.hostId) || a.kind.localeCompare(b.kind));

  return { graph: { nodes, edges }, aggregates, truncated: aggregates.length > 0 };
}

/** Flow order (left→right): rules populate groups, groups grant apps. Policies share a lane. */
const FLOW_ORDER: Record<NodeKind, number> = {
  GroupRule: 0,
  Group: 1,
  GlobalSessionPolicy: 1,
  App: 2,
  AppAuthPolicy: 2,
};

/** Which side of the focus a truncated-neighbor pill belongs on: upstream kinds left, else right. */
export function aggregateSide(hostKind: NodeKind, neighborKind: NodeKind): "left" | "right" {
  return FLOW_ORDER[neighborKind] < FLOW_ORDER[hostKind] ? "left" : "right";
}

/** The neighbors of `hostId` of a given kind NOT shown in the view — what a "+N more" stands for.
 * PURE; used by the panel (pill click → browsable list). */
export function hiddenNeighbors(
  view: FocusView,
  indexes: GraphIndexes,
  hostId: string,
  kind?: NodeKind,
): string[] {
  const visible = new Set(view.graph.nodes.map((n) => n.id));
  return (indexes.neighbors.get(hostId) ?? [])
    .filter((id) => !visible.has(id) && (kind == null || indexes.nodeById.get(id)?.kind === kind))
    .sort();
}
