/**
 * M3 coverage oracle. `fixtures/api/*` (live) and `fixtures/sample-tenant.tfstate.json`
 * (state) describe the SAME logical tenant (proven graph-equivalent in M2), so with no
 * injection they must be 100% managed. Every other case enriches COPIES of those record
 * arrays in-test — the shared fixtures are never edited.
 */

import { describe, expect, it } from "vitest";
import { computeCoverage, countIndividualAssignments } from "../src/analysis/coverage.js";
import type { CoverageBucket, CoverageReport, ResourceKind } from "../src/analysis/coverage.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import { liveResources, realLiveResources, realStateResources, stateResources } from "./fixture.js";

const live = liveResources();
const state = stateResources();

function kindRow(report: CoverageReport, kind: ResourceKind) {
  const row = report.perKind.find((k) => k.kind === kind);
  if (!row) throw new Error(`no perKind row for ${kind}`);
  return row;
}

function keysIn(report: CoverageReport, bucket: CoverageBucket): string[] {
  return report.items
    .filter((i) => i.bucket === bucket)
    .map((i) => i.key)
    .sort();
}

// --- synthetic records (live-side unless noted) ------------------------------
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
const everyoneGroup: ParsedResource = {
  kind: "Group",
  id: "g-everyone",
  name: "Everyone",
  address: "okta-api:group/g-everyone",
  groupType: "BUILT_IN",
};
const systemSignonPolicy: ParsedResource = {
  kind: "GlobalSessionPolicy",
  id: "p-default-signon",
  name: "Default Policy",
  address: "okta-api:policy_signon/p-default-signon",
  groupsIncluded: ["g-everyone"],
  system: true,
};
const dashboardPolicy: ParsedResource = {
  kind: "AppAuthPolicy",
  id: "p-dashboard",
  name: "Okta Dashboard",
  address: "okta-api:app_signon_policy/p-dashboard",
};

describe("computeCoverage — baseline (same tenant, both sides)", () => {
  const report = computeCoverage(live, state);

  it("is 100% managed with nothing unmanaged/stale/excluded", () => {
    expect(report.overall).toEqual({
      managed: 10,
      unmanaged: 0,
      stale: 0,
      excluded: 0,
      coverage: 1,
    });
  });

  it("counts managed per kind (2 groups, 2 apps, 3 assignments, 1 rule, 1 session, 1 app-auth)", () => {
    expect(kindRow(report, "Group")).toMatchObject({ managed: 2, unmanaged: 0, coverage: 1 });
    expect(kindRow(report, "App")).toMatchObject({ managed: 2, unmanaged: 0, coverage: 1 });
    expect(kindRow(report, "AppGroupAssignment")).toMatchObject({ managed: 3, coverage: 1 });
    expect(kindRow(report, "GroupRule")).toMatchObject({ managed: 1, coverage: 1 });
    expect(kindRow(report, "GlobalSessionPolicy")).toMatchObject({ managed: 1, coverage: 1 });
    expect(kindRow(report, "AppAuthPolicy")).toMatchObject({ managed: 1, coverage: 1 });
  });
});

describe("computeCoverage — noise injection (built-ins are excluded, not gaps)", () => {
  const report = computeCoverage(
    [...live, everyoneGroup, systemSignonPolicy, dashboardPolicy],
    state,
  );

  it("stays 100% — excluded never enters the denominator", () => {
    expect(report.overall.coverage).toBe(1);
    expect(report.overall.managed).toBe(10);
    expect(report.overall.unmanaged).toBe(0);
    expect(report.overall.excluded).toBe(3);
  });

  it("excludes exactly the three built-ins, each with a reason", () => {
    expect(keysIn(report, "excluded")).toEqual(["g-everyone", "p-dashboard", "p-default-signon"]);
    const reasons = Object.fromEntries(
      report.items.filter((i) => i.bucket === "excluded").map((i) => [i.key, i.reason]),
    );
    expect(reasons["g-everyone"]).toMatch(/BUILT_IN/);
    expect(reasons["p-default-signon"]).toMatch(/system/i);
    expect(reasons["p-dashboard"]).toMatch(/no managed app/i);
  });
});

describe("computeCoverage — gap injection (real unmanaged resources)", () => {
  const report = computeCoverage([...live, clickOpsGroup, slackApp, ghOpsAssignment], state);

  it("reports exactly the three gaps and overall 10/13", () => {
    expect(keysIn(report, "unmanaged")).toEqual(["a-gh/g-ops", "a-slack", "g-ops"]);
    expect(report.overall).toMatchObject({ managed: 10, unmanaged: 3, stale: 0, excluded: 0 });
    expect(report.overall.coverage).toBeCloseTo(10 / 13, 10);
  });

  it("drops the affected per-kind coverage", () => {
    expect(kindRow(report, "Group")).toMatchObject({ managed: 2, unmanaged: 1 });
    expect(kindRow(report, "App")).toMatchObject({ managed: 2, unmanaged: 1 });
    expect(kindRow(report, "AppGroupAssignment")).toMatchObject({ managed: 3, unmanaged: 1 });
    expect(kindRow(report, "Group").coverage).toBeCloseTo(2 / 3, 10);
  });

  it("resolves assignment gap names from the app/group records", () => {
    const assign = report.items.find((i) => i.key === "a-gh/g-ops");
    expect(assign?.name).toBe("GitHub / Click-Ops");
  });
});

describe("computeCoverage — stale injection (state-only, report-only)", () => {
  const staleGroup: ParsedResource = {
    kind: "Group",
    id: "g-stale",
    name: "Deleted Group",
    address: "okta_group.deleted",
  };
  const report = computeCoverage(live, [...state, staleGroup]);

  it("itemizes the stale group without moving the percentage", () => {
    expect(keysIn(report, "stale")).toEqual(["g-stale"]);
    expect(report.overall.coverage).toBe(1);
    expect(report.overall.managed).toBe(10);
    expect(kindRow(report, "Group")).toMatchObject({ managed: 2, stale: 1, coverage: 1 });
  });
});

describe("computeCoverage — ordering regressions", () => {
  it("explicit org-default app policy creates no AppAuthPolicy gap or stale", () => {
    // State app carries an explicit authentication_policy id; live nulls it (system policy).
    // Presence-only compares App records by id, so this attribute difference is invisible,
    // and the org-default id is not an AppAuthPolicy resource on either side.
    const stateExplicit = state.map((r) =>
      r.kind === "App" && r.id === "a-gh" ? { ...r, authenticationPolicyId: "p-default" } : r,
    );
    const report = computeCoverage(live, stateExplicit);
    expect(kindRow(report, "AppAuthPolicy")).toMatchObject({ managed: 1, unmanaged: 0, stale: 0 });
    expect(report.items.some((i) => i.key === "p-default")).toBe(false);
  });

  it("a managed-but-unattached app auth policy is managed, never excluded/stale", () => {
    // p-unused matches the AppAuthPolicy exclusion predicate (no app references it) but is
    // present in BOTH sides. State presence must win: managed, exclusion never consulted.
    const unusedPolicy: ParsedResource = {
      kind: "AppAuthPolicy",
      id: "p-unused",
      name: "Unused-Auth",
      address: "app_signon_policy/p-unused",
    };
    const report = computeCoverage([...live, unusedPolicy], [...state, unusedPolicy]);
    const item = report.items.find((i) => i.key === "p-unused");
    expect(item?.bucket).toBe("managed");
    expect(kindRow(report, "AppAuthPolicy")).toMatchObject({ managed: 2, excluded: 0, stale: 0 });
  });
});

// --- M14 Phase A: plural-resource provenance (viaPluralResource) ---

describe("computeCoverage — plural-resource provenance (M14)", () => {
  // A live assignment (map-api never sets the flag) + a state assignment carrying it, same key.
  const liveAssign: ParsedResource = {
    kind: "AppGroupAssignment",
    address: "okta-api:app_group_assignment/a-gh/g-plural",
    appId: "a-gh",
    groupId: "g-plural",
  };
  const statePluralAssign: ParsedResource = {
    kind: "AppGroupAssignment",
    address: "okta_app_group_assignments.x",
    appId: "a-gh",
    groupId: "g-plural",
    viaPluralResource: true,
  };

  it("flags a managed pair from the STATE-side plural record (managed embeds the live record, which lacks the flag)", () => {
    const report = computeCoverage([...live, liveAssign], [...state, statePluralAssign]);
    const item = report.items.find((i) => i.key === "a-gh/g-plural");
    expect(item?.bucket).toBe("managed");
    expect(item?.viaPluralResource).toBe(true);
  });

  it("flags a stale plural pair (state-only)", () => {
    const report = computeCoverage(live, [...state, statePluralAssign]);
    const item = report.items.find((i) => i.key === "a-gh/g-plural");
    expect(item?.bucket).toBe("stale");
    expect(item?.viaPluralResource).toBe(true);
  });

  it("never flags a live-only (unmanaged) pair — the flag is a state-side concept", () => {
    const report = computeCoverage([...live, liveAssign], state);
    const item = report.items.find((i) => i.key === "a-gh/g-plural");
    expect(item?.bucket).toBe("unmanaged");
    expect(item?.viaPluralResource).toBeUndefined();
  });

  it("leaves singular-sourced managed pairs unflagged", () => {
    const report = computeCoverage(live, state);
    for (const item of report.items.filter((i) => i.kind === "AppGroupAssignment")) {
      expect(item.viaPluralResource).toBeUndefined();
    }
  });

  it("flags Confluence/Engineering managed in the real fixtures (plural-sourced today)", () => {
    // Confluence's assignments come from the plural `okta_app_group_assignments.confluence_groups`.
    const report = computeCoverage(realLiveResources(), realStateResources());
    const confluenceEng = report.items.find(
      (i) => i.kind === "AppGroupAssignment" && i.name === "Confluence / Engineering",
    );
    expect(confluenceEng?.bucket).toBe("managed");
    expect(confluenceEng?.viaPluralResource).toBe(true);
  });
});

// --- M12: individual (okta_app_user) assignments — counted, never coverage-classified ---

describe("countIndividualAssignments + coverage exclusion (M12)", () => {
  const appUser: ParsedResource = {
    kind: "AppUserAssignment",
    address: "okta_app_user.x",
    appId: "a-sf",
    userId: "u1",
  };
  const accessAssign: ParsedResource = {
    kind: "AppAccessPolicyAssignment",
    address: "okta_app_access_policy_assignment.x",
    appId: "a-gh",
    policyId: "p-auth",
  };

  it("counts okta_app_user records", () => {
    expect(countIndividualAssignments([...state, appUser, appUser])).toBe(2);
    expect(countIndividualAssignments(state)).toBe(0);
  });

  it("does NOT classify individual/access-policy assignments into any coverage bucket", () => {
    // The live snapshot structurally can't contain these, so bucketing them would be a false
    // `stale`. They must never appear as coverage items (kept out of KIND_ORDER).
    const report = computeCoverage(live, [...state, appUser, accessAssign]);
    expect(
      report.items.some(
        (i) => i.kind === "AppUserAssignment" || i.kind === "AppAccessPolicyAssignment",
      ),
    ).toBe(false);
    // ...and they do not leak into totals as a phantom stale.
    expect(report.overall.stale).toBe(0);
  });
});
