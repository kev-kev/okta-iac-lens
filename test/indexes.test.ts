/**
 * buildIndexes oracle: id lookup, symmetric flow adjacency, substring search.
 */

import { describe, expect, it } from "vitest";
import { buildIndexes } from "../src/render/web/indexes.js";
import { graphFromFixture } from "./fixture.js";
import { syntheticGraph } from "./synthetic.js";

describe("buildIndexes (fixture)", () => {
  const graph = graphFromFixture();
  const idx = buildIndexes(graph);

  it("maps every node by id", () => {
    expect(idx.nodeById.size).toBe(graph.nodes.length);
    expect(idx.nodeById.get("a-gh")?.name).toBe("GitHub");
  });

  it("builds undirected flow adjacency (grants + populates)", () => {
    expect(idx.neighbors.get("g-eng")).toContain("a-gh"); // Engineering grants GitHub
    expect(idx.neighbors.get("a-gh")).toContain("g-eng"); // and the reverse
    expect(idx.neighbors.get("g-eng")).toContain("gr-eng"); // eng-rule populates Engineering
  });

  it("searches by name and id substring", () => {
    expect(idx.search("git").map((n) => n.id)).toContain("a-gh");
    expect(idx.search("g-con").map((n) => n.name)).toContain("Contractors");
    expect(idx.search("")).toEqual([]);
  });
});

describe("buildIndexes (synthetic scale)", () => {
  const graph = syntheticGraph({ groups: 2000, apps: 1000, assignments: 8000, seed: 7 });
  const idx = buildIndexes(graph);

  it("indexes a large org and reflects the hub degree", () => {
    expect(idx.nodeById.size).toBe(3000);
    expect((idx.neighbors.get("g0") ?? []).length).toBeGreaterThanOrEqual(800); // group hub
    expect((idx.neighbors.get("a0") ?? []).length).toBeGreaterThanOrEqual(400); // app hub
  });

  it("caps search results", () => {
    expect(idx.search("App", 20)).toHaveLength(20);
  });
});
