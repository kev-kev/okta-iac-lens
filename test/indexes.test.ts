/**
 * buildIndexes oracle: id lookup, symmetric flow adjacency, substring search.
 */

import { describe, expect, it } from "vitest";
import { buildIndexes } from "../src/render/web/indexes.js";
import type { GraphNode, OktaGraph } from "../src/core/model.js";
import { graphFromFixture } from "./fixture.js";
import { syntheticGraph } from "./synthetic.js";

/** A bare Group node — enough to exercise name/id ranking. */
function group(id: string, name: string): GraphNode {
  return { id, kind: "Group", name, address: `okta_group.${id}` };
}

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

describe("buildIndexes search ranking", () => {
  // Query "eng" hits each of these at a different relevance tier.
  const graph: OktaGraph = {
    nodes: [
      group("g-buried", "Avengers"), // "eng" buried mid-token (tier 3), longer name
      group("g-sub", "Reng"), // "eng" mid-token (tier 3), shorter name
      group("g-word", "Platform Engineers"), // a word starts with "eng" (tier 2)
      group("g-prefix", "Engineering"), // name starts with "eng" (tier 1)
      // id-only match: the name "Widgets" doesn't match, but the id does.
      { id: "eng-team", kind: "Group", name: "Widgets", address: "okta_group.eng_team" },
      group("g-exact", "eng"), // exact (tier 0)
    ],
    edges: [],
  };
  const idx = buildIndexes(graph);

  it("orders exact › prefix › word-boundary › substring, with id-only matches last", () => {
    expect(idx.search("eng").map((n) => n.id)).toEqual([
      "g-exact", // 0 exact name
      "g-prefix", // 1 name prefix
      "g-word", // 2 word-boundary in name
      "g-sub", // 3 name substring (shorter name sorts ahead of Avengers)
      "g-buried", // 3 name substring
      "eng-team", // id-only match, always after any name match
    ]);
  });

  it("ranks a case-insensitive exact name match first", () => {
    expect(idx.search("ENG")[0]?.id).toBe("g-exact");
  });

  it("respects the limit after ranking", () => {
    expect(idx.search("eng", 2).map((n) => n.id)).toEqual(["g-exact", "g-prefix"]);
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
