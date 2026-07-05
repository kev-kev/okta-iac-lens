/**
 * buildFocusView oracle — the bounded-view engine. Exact counts on a controlled hub; the
 * budget/hub invariants hold on a synthetic enterprise-scale org.
 */

import { describe, expect, it } from "vitest";
import type { CoverageBucket } from "../src/analysis/coverage.js";
import type { Edge, GraphNode, OktaGraph } from "../src/core/model.js";
import { buildIndexes } from "../src/render/web/indexes.js";
import { buildFocusView, hiddenNeighbors } from "../src/render/web/build-focus-view.js";
import { syntheticGraph } from "./synthetic.js";

/** A star: one group granting `fanout` apps (apps have no other neighbors). */
function starGraph(fanout: number): OktaGraph {
  const nodes: GraphNode[] = [{ kind: "Group", id: "hub", name: "Hub", address: "x" }];
  const edges: Edge[] = [];
  for (let i = 0; i < fanout; i++) {
    nodes.push({ kind: "App", id: `a${i}`, name: `App ${i}`, address: "x", appType: "okta_app_oauth" });
    edges.push({ kind: "grants", from: "hub", to: `a${i}` });
  }
  return { nodes, edges };
}

describe("buildFocusView (controlled hub)", () => {
  const graph = starGraph(20);
  const idx = buildIndexes(graph);

  it("truncates a hub to k neighbors + one aggregate reporting the remainder", () => {
    const view = buildFocusView(graph, idx, ["hub"], { budget: 150, hubK: 12 });
    expect(view.graph.nodes).toHaveLength(1 + 12); // hub + 12 apps
    expect(view.graph.edges).toHaveLength(12); // 12 grants edges
    expect(view.aggregates).toEqual([{ id: "agg:hub", hostId: "hub", hiddenCount: 8 }]);
    expect(view.truncated).toBe(true);
  });

  it("shows the whole neighborhood untruncated when it fits", () => {
    const view = buildFocusView(graph, idx, ["hub"], { budget: 150, hubK: 50 });
    expect(view.graph.nodes).toHaveLength(21);
    expect(view.aggregates).toEqual([]);
    expect(view.truncated).toBe(false);
  });

  it("prefers unmanaged neighbors when the hub cap bites", () => {
    // Mark the last 3 apps unmanaged; with hubK=3 they should be the ones admitted.
    const bucketByNodeId = new Map<string, CoverageBucket>([
      ["a17", "unmanaged"],
      ["a18", "unmanaged"],
      ["a19", "unmanaged"],
    ]);
    const view = buildFocusView(graph, idx, ["hub"], { budget: 150, hubK: 3, bucketByNodeId });
    const visibleApps = view.graph.nodes.filter((n) => n.kind === "App").map((n) => n.id).sort();
    expect(visibleApps).toEqual(["a17", "a18", "a19"]);
  });
});

describe("buildFocusView (depth semantics — the view is trace-shaped, not a flood)", () => {
  /** A path: g1 -grants- a1 ... alternating groups/apps, length 5. */
  function pathGraph(): OktaGraph {
    const nodes: GraphNode[] = [
      { kind: "Group", id: "g1", name: "G1", address: "x" },
      { kind: "App", id: "a1", name: "A1", address: "x", appType: "okta_app_oauth" },
      { kind: "Group", id: "g2", name: "G2", address: "x" },
      { kind: "App", id: "a2", name: "A2", address: "x", appType: "okta_app_oauth" },
      { kind: "Group", id: "g3", name: "G3", address: "x" },
    ];
    const edges: Edge[] = [
      { kind: "grants", from: "g1", to: "a1" },
      { kind: "grants", from: "g2", to: "a1" },
      { kind: "grants", from: "g2", to: "a2" },
      { kind: "grants", from: "g3", to: "a2" },
    ];
    return { nodes, edges };
  }

  it("stops at depth 2: focusing g1 shows g1, a1, g2 — never a2/g3 three hops out", () => {
    const graph = pathGraph();
    const view = buildFocusView(graph, buildIndexes(graph), ["g1"]);
    expect(view.graph.nodes.map((n) => n.id).sort()).toEqual(["a1", "g1", "g2"]);
    // g2's unexpanded fan-out (a2) is frontier, not signal: no aggregate, no truncation flag.
    expect(view.aggregates).toEqual([]);
    expect(view.truncated).toBe(false);
  });

  it("emits aggregates only on the focus and its direct neighbors", () => {
    const graph = syntheticGraph({ groups: 1500, apps: 800, assignments: 6000, seed: 5 });
    const idx = buildIndexes(graph);
    const view = buildFocusView(graph, idx, ["g0"]); // the hub group
    const nearFocus = new Set(["g0", ...(idx.neighbors.get("g0") ?? [])]);
    for (const agg of view.aggregates) {
      expect(nearFocus.has(agg.hostId), `aggregate on far node ${agg.hostId}`).toBe(true);
    }
  });

  it("hiddenNeighbors lists exactly what an aggregate stands for", () => {
    const graph = starGraph(20);
    const idx = buildIndexes(graph);
    const view = buildFocusView(graph, idx, ["hub"], { budget: 150, hubK: 12 });
    const hidden = hiddenNeighbors(view, idx, "hub");
    expect(hidden).toHaveLength(8); // matches the aggregate's hiddenCount
    const visible = new Set(view.graph.nodes.map((n) => n.id));
    for (const id of hidden) expect(visible.has(id)).toBe(false);
  });
});

describe("buildFocusView (synthetic scale)", () => {
  const graph = syntheticGraph({ groups: 4000, apps: 2000, assignments: 20_000, seed: 3 });
  const idx = buildIndexes(graph);

  it("never exceeds the node budget for any focus (incl. the hubs)", () => {
    const budget = 150;
    for (const focus of ["g0", "a0", "g1234", "a999"]) {
      const view = buildFocusView(graph, idx, [focus], { budget, hubK: 12 });
      expect(view.graph.nodes.length).toBeLessThanOrEqual(budget);
    }
  });

  it("focusing a hub stays bounded and reports truncation", () => {
    const view = buildFocusView(graph, idx, ["g0"], { budget: 150, hubK: 12 });
    expect(view.graph.nodes.length).toBeLessThanOrEqual(150);
    expect(view.truncated).toBe(true);
    expect(view.aggregates.length).toBeGreaterThan(0);
  });
});
