/**
 * coverage-badges oracle: report items -> the canvas elements that render them (node cards,
 * grants edges, policy badges).
 */

import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/analysis/coverage.js";
import { coverageBadges } from "../src/render/web/coverage-badges.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import { liveResources, stateResources } from "./fixture.js";

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

describe("coverageBadges", () => {
  it("marks gap resources unmanaged on cards and on the grants edge", () => {
    const live = [...liveResources(), clickOpsGroup, slackApp, ghOps];
    const b = coverageBadges(computeCoverage(live, state));
    expect(b.bucketByNodeId.get("g-ops")).toBe("unmanaged");
    expect(b.bucketByNodeId.get("a-slack")).toBe("unmanaged");
    expect(b.bucketByNodeId.get("g-eng")).toBe("managed");
    // assignment key a-gh/g-ops -> grants edge runs group->app => grants:g-ops:a-gh
    expect(b.bucketByEdgeId.get("grants:g-ops:a-gh")).toBe("unmanaged");
    expect(b.bucketByEdgeId.get("grants:g-eng:a-gh")).toBe("managed");
  });

  it("routes policy buckets to policy ids and excludes built-in groups", () => {
    const live = [...liveResources(), everyone];
    const b = coverageBadges(computeCoverage(live, state));
    expect(b.bucketByNodeId.get("g-everyone")).toBe("excluded");
    expect(b.bucketByPolicyId.get("p-auth")).toBe("managed"); // Strict-Auth, in both sides
  });
});
