/**
 * buildFocusView oracle — the DEPTH-1 ego view. The focus + only its direct neighbors, each kind
 * capped with a typed "+N more <kind>" aggregate. No two-hop expansion, ever.
 */

import { describe, expect, it } from "vitest";
import type { CoverageBucket } from "../src/analysis/coverage.js";
import type { Edge, GraphNode, OktaGraph } from "../src/core/model.js";
import { buildIndexes } from "../src/render/web/indexes.js";
import {
  aggregateSide,
  buildFocusView,
  hiddenNeighbors,
} from "../src/render/web/build-focus-view.js";
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

  it("caps a kind to perSideCap + one typed aggregate for the remainder", () => {
    const view = buildFocusView(graph, idx, ["hub"], { perSideCap: 12 });
    expect(view.graph.nodes).toHaveLength(1 + 12); // hub + 12 apps
    expect(view.graph.edges).toHaveLength(12);
    expect(view.aggregates).toEqual([
      { id: "agg:hub:App", hostId: "hub", kind: "App", hiddenCount: 8 },
    ]);
    expect(view.truncated).toBe(true);
  });

  it("shows the whole neighborhood untruncated when it fits", () => {
    const view = buildFocusView(graph, idx, ["hub"], { perSideCap: 50 });
    expect(view.graph.nodes).toHaveLength(21);
    expect(view.aggregates).toEqual([]);
    expect(view.truncated).toBe(false);
  });

  it("admits unmanaged neighbors first when the cap bites", () => {
    const bucketByNodeId = new Map<string, CoverageBucket>([
      ["a17", "unmanaged"],
      ["a18", "unmanaged"],
      ["a19", "unmanaged"],
    ]);
    const view = buildFocusView(graph, idx, ["hub"], { perSideCap: 3, bucketByNodeId });
    const visibleApps = view.graph.nodes.filter((n) => n.kind === "App").map((n) => n.id).sort();
    expect(visibleApps).toEqual(["a17", "a18", "a19"]);
  });
});

describe("buildFocusView (depth-1 only — no two-hop flood)", () => {
  /** g1-a1-g2-a2-g3 path: focusing g1 must NOT reach g2 (two hops via a1). */
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

  it("focusing g1 shows ONLY g1 + a1 — never the sibling group g2 two hops out", () => {
    const graph = pathGraph();
    const view = buildFocusView(graph, buildIndexes(graph), ["g1"]);
    expect(view.graph.nodes.map((n) => n.id).sort()).toEqual(["a1", "g1"]);
    expect(view.aggregates).toEqual([]);
  });

  it("every aggregate hangs off the focus itself (no far-node pills)", () => {
    const graph = syntheticGraph({ groups: 1500, apps: 800, assignments: 6000, seed: 5 });
    const idx = buildIndexes(graph);
    const view = buildFocusView(graph, idx, ["g0"]);
    for (const agg of view.aggregates) expect(agg.hostId).toBe("g0");
  });

  it("hiddenNeighbors(kind) lists exactly what a typed aggregate stands for", () => {
    const graph = starGraph(20);
    const idx = buildIndexes(graph);
    const view = buildFocusView(graph, idx, ["hub"], { perSideCap: 12 });
    const hidden = hiddenNeighbors(view, idx, "hub", "App");
    expect(hidden).toHaveLength(8);
    const visible = new Set(view.graph.nodes.map((n) => n.id));
    for (const id of hidden) expect(visible.has(id)).toBe(false);
  });
});

describe("aggregateSide", () => {
  it("puts upstream neighbor kinds left, downstream right", () => {
    // App focus: its granting Groups are upstream (left).
    expect(aggregateSide("App", "Group")).toBe("left");
    // Group focus: its granted Apps are downstream (right); populating Rules upstream (left).
    expect(aggregateSide("Group", "App")).toBe("right");
    expect(aggregateSide("Group", "GroupRule")).toBe("left");
  });
});

describe("buildFocusView (synthetic scale)", () => {
  const graph = syntheticGraph({ groups: 4000, apps: 2000, assignments: 20_000, seed: 3 });
  const idx = buildIndexes(graph);

  it("stays tiny per focus — at most a few caps' worth of nodes, even for hubs", () => {
    for (const focus of ["g0", "a0", "g1234", "a999"]) {
      const view = buildFocusView(graph, idx, [focus], { perSideCap: 12 });
      // depth-1 with per-kind caps: focus + at most a couple kinds × 12.
      expect(view.graph.nodes.length).toBeLessThanOrEqual(1 + 12 * 3);
    }
  });

  it("focusing a hub reports truncation with a typed aggregate", () => {
    const view = buildFocusView(graph, idx, ["g0"], { perSideCap: 12 });
    expect(view.truncated).toBe(true);
    expect(view.aggregates.some((a) => a.kind === "App" && a.hiddenCount > 0)).toBe(true);
  });
});
