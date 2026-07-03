/**
 * Layout oracle: two-lane structure (resource spine + policy lane above), one position per
 * node, no overlaps, deterministic.
 */

import { describe, expect, it } from "vitest";
import { layoutGraph } from "../src/render/web/layout.js";
import { graphFromFixture } from "./fixture.js";

describe("layoutGraph (two-lane: resource spine + policy lane)", () => {
  const graph = graphFromFixture();
  const pos = layoutGraph(graph);

  const at = (id: string) => {
    const p = pos.get(id);
    if (!p) throw new Error(`no position for ${id}`);
    return p;
  };

  it("assigns exactly one position to every node", () => {
    expect(pos.size).toBe(graph.nodes.length);
    for (const n of graph.nodes) expect(pos.has(n.id)).toBe(true);
  });

  it("orders the resource spine left -> right: rule < group < app", () => {
    expect(at("gr-eng").x).toBeLessThan(at("g-eng").x);
    expect(at("g-eng").x).toBeLessThan(at("a-gh").x);
    expect(at("g-eng").x).toBe(at("g-con").x); // groups share a column
    expect(at("a-gh").x).toBe(at("a-dd").x); // apps share a column
  });

  it("places each policy in the lane ABOVE the resource column it gates", () => {
    // Session policy shares the Group column and sits above it.
    expect(at("p-sess").x).toBe(at("g-eng").x);
    expect(at("p-sess").y).toBeLessThan(at("g-eng").y);
    // App auth policy shares the App column and sits above it.
    expect(at("p-auth").x).toBe(at("a-gh").x);
    expect(at("p-auth").y).toBeLessThan(at("a-gh").y);
  });

  it("keeps the spine below the policy lane (rule is not up in the policy row)", () => {
    expect(at("gr-eng").y).toBe(at("g-eng").y); // spine nodes share a baseline row
    expect(at("gr-eng").y).toBeGreaterThan(at("p-sess").y);
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
    for (const n of graph.nodes) expect(again.get(n.id)).toEqual(pos.get(n.id));
  });

  it("stacks multiple groups in the column at distinct y", () => {
    expect(at("g-eng").y).not.toBe(at("g-con").y);
  });
});
