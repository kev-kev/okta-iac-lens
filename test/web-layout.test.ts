/**
 * Layout oracle: deterministic layered columns, one position per node, no overlaps.
 */

import { describe, expect, it } from "vitest";
import { layoutGraph } from "../src/render/web/layout.js";
import type { GraphNode } from "../src/core/model.js";
import { graphFromFixture } from "./fixture.js";

describe("layoutGraph", () => {
  const graph = graphFromFixture();
  const pos = layoutGraph(graph);

  const xOf = (id: string): number => {
    const p = pos.get(id);
    if (!p) throw new Error(`no position for ${id}`);
    return p.x;
  };

  it("assigns exactly one position to every node", () => {
    expect(pos.size).toBe(graph.nodes.length);
    for (const n of graph.nodes) expect(pos.has(n.id)).toBe(true);
  });

  it("puts each kind in its own column (Groups share x, Apps share x, columns ordered)", () => {
    expect(xOf("g-eng")).toBe(xOf("g-con"));
    expect(xOf("a-gh")).toBe(xOf("a-dd"));
    // GroupRule < GlobalSessionPolicy < Group < AppAuthPolicy < App
    // (each policy column sits left/upstream of what it gates, so all edges flow forward)
    expect(xOf("gr-eng")).toBeLessThan(xOf("p-sess"));
    expect(xOf("p-sess")).toBeLessThan(xOf("g-eng"));
    expect(xOf("g-eng")).toBeLessThan(xOf("p-auth"));
    expect(xOf("p-auth")).toBeLessThan(xOf("a-gh"));
  });

  it("never places two nodes at the same coordinates", () => {
    const seen = new Set<string>();
    for (const p of pos.values()) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("is deterministic across runs", () => {
    const again = layoutGraph(graph);
    for (const n of graph.nodes) {
      expect(again.get(n.id)).toEqual(pos.get(n.id));
    }
  });

  it("stacks multiple nodes in a column at distinct y", () => {
    const groups: GraphNode[] = graph.nodes.filter((n) => n.kind === "Group");
    const ys = groups.map((g) => pos.get(g.id)?.y);
    expect(new Set(ys).size).toBe(groups.length);
  });
});
