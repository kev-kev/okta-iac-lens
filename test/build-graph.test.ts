import { describe, expect, it } from "vitest";
import type { EdgeKind } from "../src/core/model.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();

function hasEdge(kind: EdgeKind, from: string, to: string): boolean {
  return graph.edges.some((e) => e.kind === kind && e.from === from && e.to === to);
}
function countEdges(kind: EdgeKind): number {
  return graph.edges.filter((e) => e.kind === kind).length;
}

describe("buildGraph", () => {
  it("creates one node per resource (2 groups + 2 apps + rule + gsp + aap = 7)", () => {
    expect(graph.nodes).toHaveLength(7);
  });

  it("wires grants: Group -> App", () => {
    expect(hasEdge("grants", "g-eng", "a-gh")).toBe(true);
    expect(hasEdge("grants", "g-eng", "a-dd")).toBe(true);
    expect(hasEdge("grants", "g-con", "a-gh")).toBe(true);
    expect(countEdges("grants")).toBe(3);
  });

  it("wires populates: GroupRule -> Group", () => {
    expect(hasEdge("populates", "gr-eng", "g-eng")).toBe(true);
    expect(countEdges("populates")).toBe(1);
  });

  it("wires appliesTo: GlobalSessionPolicy -> Group", () => {
    expect(hasEdge("appliesTo", "p-sess", "g-eng")).toBe(true);
    expect(countEdges("appliesTo")).toBe(1);
  });

  it("wires protects: AppAuthPolicy -> App (only the app that sets authentication_policy)", () => {
    expect(hasEdge("protects", "p-auth", "a-dd")).toBe(true);
    expect(countEdges("protects")).toBe(1);
  });
});
