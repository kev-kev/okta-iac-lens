/**
 * CLI-layer coverage: the loaders' error/IO paths and the text/JSON renderer. The full
 * live command is exercised in Phase B (needs a tenant); here we test everything reachable
 * offline, including the missing-credentials error path.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/analysis/coverage.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import { loadLiveResources, loadStateResources } from "../src/inputs/load-resources.js";
import { renderCoverage } from "../src/render/cli.js";
import { liveResources, stateResources } from "./fixture.js";

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
const ghOpsAssignment: ParsedResource = {
  kind: "AppGroupAssignment",
  address: "x",
  appId: "a-gh",
  groupId: "g-ops",
};

describe("loadLiveResources — missing credentials", () => {
  it("rejects with an actionable error before any network call", async () => {
    await expect(loadLiveResources({})).rejects.toThrow(/OKTA_ORG_URL and OKTA_API_TOKEN/);
  });
});

describe("loadStateResources", () => {
  it("reads the tfstate fixture from disk into normalized records", async () => {
    const path = fileURLToPath(new URL("../fixtures/sample-tenant.tfstate.json", import.meta.url));
    expect(await loadStateResources(path)).toHaveLength(10);
  });
});

describe("renderCoverage", () => {
  const live = [...liveResources(), clickOpsGroup, slackApp, ghOpsAssignment];
  const report = computeCoverage(live, stateResources());

  it("renders a text report with the table, overall %, and the itemized gaps", () => {
    const text = renderCoverage(report, "text");
    expect(text).toContain("IaC coverage");
    expect(text).toContain("overall");
    expect(text).toContain("76.9%"); // overall 10/13
    expect(text).toContain("- [App] Slack (a-slack)");
    expect(text).toContain("- [AppGroupAssignment] GitHub / Click-Ops (a-gh/g-ops)");
  });

  it("labels excluded items with their reason", () => {
    const everyone: ParsedResource = {
      kind: "Group",
      id: "g-everyone",
      name: "Everyone",
      address: "x",
      groupType: "BUILT_IN",
    };
    const text = renderCoverage(computeCoverage([...live, everyone], stateResources()), "text");
    expect(text).toMatch(/- \[Group\] Everyone \(g-everyone\) — .*BUILT_IN/);
  });

  it("renders JSON with the overall totals", () => {
    const parsed = JSON.parse(renderCoverage(report, "json"));
    expect(parsed.overall).toMatchObject({ managed: 10, unmanaged: 3 });
  });
});
