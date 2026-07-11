import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/build-graph.js";
import { parseTfState } from "../src/core/parse-tfstate.js";
import { sessionPolicyForGroup, summarize, trace } from "../src/core/access-paths.js";
import type { OktaGraph } from "../src/core/model.js";
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

describe("sessionPolicyForGroup — M12 priority evaluation", () => {
  /** A graph where the listed policies each apply to group "g". */
  const graphWith = (
    policies: { id: string; priority?: number; status?: string }[],
  ): OktaGraph => ({
    nodes: [
      { kind: "Group", id: "g", name: "G", address: "g" },
      ...policies.map((p) => ({
        kind: "GlobalSessionPolicy" as const,
        id: p.id,
        name: p.id,
        address: p.id,
        priority: p.priority,
        status: p.status,
      })),
    ],
    edges: policies.map((p) => ({ kind: "appliesTo" as const, from: p.id, to: "g" })),
  });

  it("picks the LOWEST-priority policy, regardless of edge (address) order", () => {
    // Edge order lists prio-2 first; the correct answer is the prio-1 policy.
    const g = graphWith([
      { id: "default-mfa", priority: 2 },
      { id: "stricter", priority: 1 },
    ]);
    expect(sessionPolicyForGroup(g, "g")?.id).toBe("stricter");
  });

  it("skips INACTIVE policies even when they have a lower priority", () => {
    const g = graphWith([
      { id: "inactive-top", priority: 1, status: "INACTIVE" },
      { id: "active-next", priority: 2, status: "ACTIVE" },
    ]);
    expect(sessionPolicyForGroup(g, "g")?.id).toBe("active-next");
  });

  it("treats absent priority as lowest precedence (sorts last)", () => {
    const g = graphWith([{ id: "no-prio" }, { id: "prio-5", priority: 5 }]);
    expect(sessionPolicyForGroup(g, "g")?.id).toBe("prio-5");
  });

  it("breaks ties deterministically by id", () => {
    const g = graphWith([
      { id: "bbb", priority: 1 },
      { id: "aaa", priority: 1 },
    ]);
    expect(sessionPolicyForGroup(g, "g")?.id).toBe("aaa");
  });

  it("returns null when no policy applies", () => {
    expect(sessionPolicyForGroup(graphWith([]), "g")).toBeNull();
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
