import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/build-graph.js";
import { parseTfState } from "../src/core/parse-tfstate.js";
import { summarize, trace } from "../src/core/access-paths.js";
import { flattenModules, graphFromFixture, loadFixtureJson } from "./fixture.js";

const graph = graphFromFixture();

describe("trace", () => {
  it("Engineering: GitHub + Datadog; Default-MFA session; Datadog under Strict-Auth", () => {
    const t = trace(graph, "Engineering");
    expect(t.group.id).toBe("g-eng");
    expect(t.apps.map((a) => a.name)).toEqual(["GitHub", "Datadog"]);
    expect(t.globalSessionPolicy?.name).toBe("Default-MFA");
    expect(Object.keys(t.appAuthPolicies).sort()).toEqual(["a-dd", "a-gh"]);
    expect(t.appAuthPolicies["a-gh"]).toBeNull(); // org default
    expect(t.appAuthPolicies["a-dd"]?.name).toBe("Strict-Auth");
  });

  it("Contractors: GitHub only; no session policy; org default app policy", () => {
    const t = trace(graph, "Contractors");
    expect(t.apps.map((a) => a.name)).toEqual(["GitHub"]);
    expect(t.globalSessionPolicy).toBeNull();
    expect(t.appAuthPolicies).toEqual({ "a-gh": null });
  });

  it("matches a group by id as well as by name", () => {
    expect(trace(graph, "g-eng").group.name).toBe("Engineering");
  });

  it("throws on an unknown group", () => {
    expect(() => trace(graph, "Nope")).toThrow(/Group not found/);
  });
});

describe("summarize", () => {
  it("counts nodes by kind (the oracle)", () => {
    expect(summarize(graph)).toEqual({
      groups: 2,
      apps: 2,
      groupRules: 1,
      globalSessionPolicies: 1,
      appAuthPolicies: 1,
    });
  });
});

describe("module nesting invariance", () => {
  it("gives identical trace + summary whether the policy is nested or flat", () => {
    const flatGraph = buildGraph(parseTfState(flattenModules(loadFixtureJson())));
    expect(trace(flatGraph, "Engineering")).toEqual(trace(graph, "Engineering"));
    expect(trace(flatGraph, "Contractors")).toEqual(trace(graph, "Contractors"));
    expect(summarize(flatGraph)).toEqual(summarize(graph));
  });
});
