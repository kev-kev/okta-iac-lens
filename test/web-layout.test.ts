/**
 * Layout oracle (dagre). We don't assert exact coordinates (that's dagre's job and brittle);
 * we assert the structural invariants that matter: every flow node placed, left-to-right rank
 * order along the access flow, no overlapping cards, and determinism.
 */

import { describe, expect, it } from "vitest";
import { deriveCards } from "../src/render/web/derive-cards.js";
import {
  COMPACT_SPACING,
  DEFAULT_SPACING,
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "../src/render/web/layout.js";
import { graphFromFixture } from "./fixture.js";

const flow = deriveCards(graphFromFixture()).flow;

describe("layoutGraph (dagre)", () => {
  const pos = layoutGraph(flow);
  const at = (id: string) => {
    const p = pos.get(id);
    if (!p) throw new Error(`no position for ${id}`);
    return p;
  };

  it("positions every flow node (and only flow nodes — policies aren't in the flow graph)", () => {
    expect(pos.size).toBe(flow.nodes.length);
    for (const n of flow.nodes) expect(pos.has(n.id)).toBe(true);
    expect(pos.has("p-sess")).toBe(false);
    expect(pos.has("p-auth")).toBe(false);
  });

  it("lays the access flow out left -> right: rule before group before apps", () => {
    expect(at("gr-eng").x).toBeLessThan(at("g-eng").x);
    expect(at("g-eng").x).toBeLessThan(at("a-gh").x);
    expect(at("g-eng").x).toBeLessThan(at("a-dd").x);
  });

  it("never overlaps two cards", () => {
    const ids = flow.nodes.map((n) => n.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = at(ids[i]);
        const b = at(ids[j]);
        const overlap =
          a.x < b.x + NODE_WIDTH &&
          b.x < a.x + NODE_WIDTH &&
          a.y < b.y + NODE_HEIGHT &&
          b.y < a.y + NODE_HEIGHT;
        expect(overlap, `${ids[i]} overlaps ${ids[j]}`).toBe(false);
      }
    }
  });

  it("is deterministic across runs", () => {
    const again = layoutGraph(flow);
    for (const n of flow.nodes) expect(again.get(n.id)).toEqual(pos.get(n.id));
  });

  it("compact spacing packs a shared rank tighter than the default", () => {
    // Two groups sharing the app column (a-gh, a-dd apart) — measure their vertical gap.
    const gap = (s: typeof DEFAULT_SPACING): number => {
      const p = layoutGraph(flow, [], s);
      return Math.abs((p.get("a-gh")?.y ?? 0) - (p.get("a-dd")?.y ?? 0));
    };
    expect(gap(COMPACT_SPACING)).toBeLessThan(gap(DEFAULT_SPACING));
  });

  it("lays out focus-view aggregates as real dagre nodes after their host (no manual offsets)", () => {
    const withAgg = layoutGraph(flow, [{ id: "agg:g-eng", hostId: "g-eng", hiddenCount: 5 }]);
    const agg = withAgg.get("agg:g-eng");
    const host = withAgg.get("g-eng");
    expect(agg).toBeDefined();
    expect(host).toBeDefined();
    expect(agg!.x).toBeGreaterThan(host!.x); // LR: ranked after its host
    expect(Number.isFinite(agg!.y)).toBe(true);
  });
});
