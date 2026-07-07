/**
 * buildCohorts oracle — the aggregated landing. Groups band by connectivity, apps by auth
 * policy, rules one cohort; ribbons carry aggregated edge counts. Every node lands in exactly
 * one cohort of its lane, and ribbon totals reconcile with the flow edges.
 */

import { describe, expect, it } from "vitest";
import { deriveCards } from "../src/render/web/derive-cards.js";
import { buildCohorts } from "../src/render/web/cohorts.js";
import { graphFromFixture } from "./fixture.js";
import { syntheticGraph } from "./synthetic.js";

describe("buildCohorts (fixture)", () => {
  const graph = graphFromFixture();
  const model = buildCohorts(graph, deriveCards(graph));

  it("puts every group in exactly one group-lane cohort", () => {
    const groupCohorts = model.cohorts.filter((c) => c.lane === "group");
    const members = groupCohorts.flatMap((c) => c.memberIds).sort();
    expect(members).toEqual(["g-con", "g-eng"]);
  });

  it("separates apps by auth policy (Strict-Auth vs org default)", () => {
    const appCohorts = model.cohorts.filter((c) => c.lane === "app");
    const strict = appCohorts.find((c) => c.label === "Strict-Auth");
    const dflt = appCohorts.find((c) => c.id === "apps:default");
    expect(strict?.memberIds).toEqual(["a-dd"]);
    expect(dflt?.memberIds).toEqual(["a-gh"]); // GitHub is org default
  });

  it("emits ribbons whose counts reconcile with the flow edges", () => {
    const total = model.ribbons.reduce((s, r) => s + r.count, 0);
    const flowEdges = graph.edges.filter((e) => e.kind === "populates" || e.kind === "grants");
    expect(total).toBe(flowEdges.length);
  });
});

describe("buildCohorts (synthetic scale)", () => {
  const graph = syntheticGraph({ groups: 4000, apps: 2000, assignments: 20_000, seed: 3 });
  const model = buildCohorts(graph, deriveCards(graph));

  it("collapses a huge org into a handful of cohorts", () => {
    expect(model.cohorts.length).toBeLessThanOrEqual(15);
    // The hub group g0 (grants 800) lands in the hub band.
    const hub = model.cohorts.find((c) => c.id === "groups:hub");
    expect(hub?.memberIds).toContain("g0");
  });

  it("partitions all groups across the connectivity bands (no group lost or doubled)", () => {
    const bandMembers = model.cohorts
      .filter((c) => c.lane === "group")
      .flatMap((c) => c.memberIds);
    expect(new Set(bandMembers).size).toBe(4000);
  });
});
