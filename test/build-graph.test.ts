import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/build-graph.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
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

// --- M12: status-aware edge wiring + the second protects path ---

describe("buildGraph — M12 INACTIVE rules and access-policy assignments", () => {
  it("emits NO populates edge for an INACTIVE group rule (node kept, annotate-not-filter)", () => {
    const g = buildGraph([
      { kind: "Group", id: "g1", name: "G", address: "g" },
      {
        kind: "GroupRule",
        id: "gr",
        name: "gr",
        address: "gr",
        expression: "",
        populates: ["g1"],
        status: "INACTIVE",
      },
    ] satisfies ParsedResource[]);
    // The rule node survives (coverage still needs the object)...
    expect(g.nodes.some((n) => n.kind === "GroupRule" && n.id === "gr")).toBe(true);
    // ...but it populates no one.
    expect(g.edges.filter((e) => e.kind === "populates")).toHaveLength(0);
  });

  it("still emits populates for an ACTIVE rule and when status is absent (=> ACTIVE)", () => {
    const g = buildGraph([
      {
        kind: "GroupRule",
        id: "a",
        name: "a",
        address: "a",
        expression: "",
        populates: ["g1"],
        status: "ACTIVE",
      },
      { kind: "GroupRule", id: "b", name: "b", address: "b", expression: "", populates: ["g1"] },
    ] satisfies ParsedResource[]);
    expect(g.edges.filter((e) => e.kind === "populates")).toHaveLength(2);
  });

  it("emits a protects edge from okta_app_access_policy_assignment (second path to protects)", () => {
    const g = buildGraph([
      {
        kind: "AppAccessPolicyAssignment",
        address: "x",
        appId: "a-gh",
        policyId: "p-auth",
      },
    ] satisfies ParsedResource[]);
    expect(g.edges).toEqual([{ kind: "protects", from: "p-auth", to: "a-gh" }]);
  });

  it("does not add any node or edge for an individual (okta_app_user) assignment", () => {
    const g = buildGraph([
      { kind: "AppUserAssignment", address: "x", appId: "a-sf", userId: "u1" },
    ] satisfies ParsedResource[]);
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });
});
