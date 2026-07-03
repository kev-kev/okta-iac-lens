/**
 * Import-block generation. The gap-injection case is the plan oracle: three unmanaged
 * records -> three import blocks with the confirmed v4.20.0 ids.
 */

import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/analysis/coverage.js";
import { generateImportBlocks } from "../src/analysis/import-blocks.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import { liveResources, stateResources } from "./fixture.js";

const state = stateResources();

const clickOpsGroup: ParsedResource = {
  kind: "Group",
  id: "g-ops",
  name: "Click-Ops",
  address: "okta-api:group/g-ops",
  groupType: "OKTA_GROUP",
};
const slackApp: ParsedResource = {
  kind: "App",
  id: "a-slack",
  name: "Slack",
  appType: "okta_app_oauth",
  address: "okta-api:app/a-slack",
  authenticationPolicyId: null,
};
const ghOpsAssignment: ParsedResource = {
  kind: "AppGroupAssignment",
  address: "okta-api:app_group_assignment/a-gh/g-ops",
  appId: "a-gh",
  groupId: "g-ops",
};

function countBlocks(tf: string): number {
  return (tf.match(/^import \{/gm) ?? []).length;
}

describe("generateImportBlocks — gap oracle", () => {
  const live = [...liveResources(), clickOpsGroup, slackApp, ghOpsAssignment];
  const report = computeCoverage(live, state);
  const tf = generateImportBlocks(report, live);

  it("emits exactly one block per unmanaged record", () => {
    expect(countBlocks(tf)).toBe(3);
  });

  it("uses the confirmed resource types, labels, and import ids", () => {
    expect(tf).toContain("  to = okta_group.click_ops\n  id = \"g-ops\"");
    expect(tf).toContain("  to = okta_app_oauth.slack\n  id = \"a-slack\"");
    expect(tf).toContain(
      "  to = okta_app_group_assignment.github_click_ops\n  id = \"a-gh/g-ops\"",
    );
  });
});

describe("generateImportBlocks — edge cases", () => {
  it("comments out an app with an unmapped sign-on mode instead of guessing a type", () => {
    const weirdApp: ParsedResource = {
      kind: "App",
      id: "a-weird",
      name: "Legacy App",
      appType: "okta_app_unknown:SAML_1_1",
      address: "okta-api:app/a-weird",
      authenticationPolicyId: null,
    };
    const live = [...liveResources(), weirdApp];
    const tf = generateImportBlocks(computeCoverage(live, state), live);

    expect(tf).toContain('# Unmapped app sign-on mode "SAML_1_1" for app "Legacy App" (a-weird)');
    expect(tf).toContain("#   to = okta_app_<TYPE>.legacy_app");
    expect(countBlocks(tf)).toBe(0); // the commented block is not a real `import {`
    expect(tf).not.toMatch(/\n {2}to = okta_app_unknown/); // never an uncommented guess
  });

  it("dedupes colliding labels with a numeric suffix", () => {
    const a: ParsedResource = {
      kind: "Group",
      id: "g-1",
      name: "My-Team",
      address: "x",
      groupType: "OKTA_GROUP",
    };
    const b: ParsedResource = {
      kind: "Group",
      id: "g-2",
      name: "My Team",
      address: "x",
      groupType: "OKTA_GROUP",
    };
    const live = [...liveResources(), a, b];
    const tf = generateImportBlocks(computeCoverage(live, state), live);

    expect(tf).toContain("okta_group.my_team\n");
    expect(tf).toContain("okta_group.my_team_2\n");
  });

  it("returns a no-op note when there are no gaps", () => {
    const live = liveResources();
    const tf = generateImportBlocks(computeCoverage(live, state), live);
    expect(countBlocks(tf)).toBe(0);
    expect(tf).toContain("No unmanaged resources");
  });
});
