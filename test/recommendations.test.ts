/**
 * recommend() oracle — derived guidance over the coverage buckets. Reuses the M3 in-test
 * injections so the report shapes match the coverage oracle exactly.
 */

import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/analysis/coverage.js";
import { recommend } from "../src/analysis/recommendations.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import { liveResources, stateResources } from "./fixture.js";

const live = liveResources();
const state = stateResources();

const clickOpsGroup: ParsedResource = {
  kind: "Group",
  id: "g-ops",
  name: "Click-Ops",
  address: "x",
  groupType: "OKTA_GROUP",
};
const slackApp: ParsedResource = {
  kind: "App",
  id: "a-slack",
  name: "Slack",
  appType: "okta_app_oauth",
  address: "x",
  authenticationPolicyId: null,
};
const ghOps: ParsedResource = { kind: "AppGroupAssignment", address: "x", appId: "a-gh", groupId: "g-ops" };
const everyone: ParsedResource = {
  kind: "Group",
  id: "g-everyone",
  name: "Everyone",
  address: "x",
  groupType: "BUILT_IN",
};

describe("recommend", () => {
  it("baseline (100%): a single success confirmation, no action items", () => {
    const recs = recommend(computeCoverage(live, state));
    expect(recs).toHaveLength(1);
    expect(recs[0].severity).toBe("success");
  });

  it("gap injection: an action headline with per-kind breakdown and the --imports path", () => {
    const recs = recommend(computeCoverage([...live, clickOpsGroup, slackApp, ghOps], state));
    const action = recs.find((r) => r.severity === "action");
    expect(action?.title).toMatch(/Bring 3 resources/);
    expect(action?.detail).toMatch(/1 group.*1 app.*1 app-group assignment/);
    expect(action?.detail).toContain("coverage --imports");
    expect(recs.some((r) => r.severity === "success")).toBe(false);
  });

  it("stale injection: an action item to resolve stale resources", () => {
    const staleGroup: ParsedResource = { kind: "Group", id: "g-stale", name: "Old", address: "x" };
    const recs = recommend(computeCoverage(live, [...state, staleGroup]));
    expect(recs.some((r) => r.severity === "action" && /stale/i.test(r.title))).toBe(true);
  });

  it("plural-sourced pair: an info item flagging absorbs-drift, from the same shared source as the CLI", () => {
    const liveAssign: ParsedResource = {
      kind: "AppGroupAssignment",
      address: "okta-api:app_group_assignment/a-gh/g-ops",
      appId: "a-gh",
      groupId: "g-ops",
    };
    const statePluralAssign: ParsedResource = {
      kind: "AppGroupAssignment",
      address: "okta_app_group_assignments.x",
      appId: "a-gh",
      groupId: "g-ops",
      viaPluralResource: true,
    };
    const recs = recommend(
      computeCoverage([...live, clickOpsGroup, liveAssign], [...state, statePluralAssign]),
    );
    const info = recs.find((r) => r.severity === "info" && /okta_app_group_assignments/.test(r.title));
    expect(info).toBeDefined();
    expect(info?.detail).toMatch(/re-reads ALL groups/i);
  });

  it("noise only: an informational item, plus success (still no gaps)", () => {
    const recs = recommend(computeCoverage([...live, everyone], state));
    const info = recs.find((r) => r.severity === "info");
    expect(info).toBeDefined();
    expect(recs.some((r) => r.severity === "success")).toBe(true);
    expect(recs.some((r) => r.severity === "action")).toBe(false);
    // Provable-claim wording: no overclaiming "Okta built-ins or system config" blanket label —
    // the info line defers to each item's specific reason.
    expect(info?.title).toMatch(/not Terraform-manageable/i);
    expect(`${info?.title} ${info?.detail}`).not.toMatch(/built-ins or system config/i);
  });
});
