/**
 * M11 Phase D — the expected-red suite.
 *
 * These tests run against the SANITIZED real-tenant fixtures (`fixtures/api-real/`), which
 * carry the adversarial seed (Phase B). The 2026-07-10 full-repo review predicted the tool
 * would diverge from Okta ground truth on seven points. This suite converts each prediction
 * into an executable assertion of the CORRECT (ground-truth) behavior.
 *
 * Two shapes:
 *  - `it.fails(...)` — the prediction REPRODUCED. The body asserts ground truth, which the
 *    current tool violates, so the test fails-as-expected and the suite is green TODAY. When
 *    the named milestone fixes the behavior, the assertion starts passing and `it.fails` flips
 *    the suite RED — that is the signal to delete the `.fails` marker (the red has greened).
 *  - `it(...)` documenting tests — the prediction did NOT reproduce in this tenant. They lock
 *    in the actual observed behavior and point at the PLAN Phase D closure note. Do not convert
 *    these to `.fails`: there is nothing here for a later milestone to fix.
 *
 * Ground truth is the Phase C record (PLAN.md) — API-derived + human-console-confirmed.
 */

import { describe, expect, it } from "vitest";
import { trace, traceApp, traceUser, summarize } from "../src/core/access-paths.js";
import { resolveUserDirectAppsFromState } from "../src/inputs/load-resources.js";
import { computeCoverage } from "../src/analysis/coverage.js";
import {
  realStateGraph,
  realStateResources,
  realLiveGraph,
  realLiveResources,
  loadRealStateJson,
} from "./fixture.js";

// --- Ground-truth ids/names from the sanitized fixtures (see PLAN.md Phase C record) ---
const ENGINEERING = "00g1eb226ab3a262cf5b";
const TEST_USER = { id: "00u1165d1e626b553034", login: "test.user@example.com" };
const APP_USER_ID = "00u1165d1e626b553034"; // the okta_app_user record's `id` (a user id, not an app id)
const REAL_APP_LABELS = ["Confluence", "Datadog", "GitHub", "Salesforce", "Wiki"]; // the 5 managed apps

describe("M12 — greened reds (were M11 Phase D `it.fails`; now pass)", () => {
  it("M12: okta_app_* lookalikes must NOT become App nodes (okta_app_user is not an app)", () => {
    const appIds = realStateGraph()
      .nodes.filter((n) => n.kind === "App")
      .map((n) => n.id);
    // The seed's okta_app_user (test user -> Salesforce) used to slip through the narrow
    // APP_TYPE_DENYLIST and become a junk App node with an empty name. M12's ALLOWLIST fixed it.
    // Ground truth: exactly the 5 managed apps, no user id.
    expect(appIds).not.toContain(APP_USER_ID);
    expect(appIds).toHaveLength(REAL_APP_LABELS.length);
  });

  it("M12: the junk App node must not appear as a phantom `stale` App in coverage", () => {
    const cov = computeCoverage(realLiveResources(), realStateResources());
    const staleApps = cov.items.filter((i) => i.kind === "App" && i.bucket === "stale");
    // The okta_app_user junk node was state-only (live has no such app), so it used to be
    // misreported as a `stale` App — a deleted-out-of-band false positive. M12 allowlist fixed it.
    expect(staleApps).toHaveLength(0);
  });

  it("M12: session policy for a group is chosen by priority, not tfstate address order", () => {
    // Two okta_policy_signon both include Engineering: Stricter-Session (priority 1) and
    // Default-MFA (priority 2). Okta evaluates priority 1 first -> Stricter-Session wins.
    // The tfstate path used to take the first `appliesTo` edge (address order) -> Default-MFA.
    const picked = trace(realStateGraph(), "Engineering").globalSessionPolicy?.name;
    expect(picked).toBe("Stricter-Session");
  });

  it("M12: an INACTIVE group rule populates no one (status is now evaluated)", () => {
    // `inactive-contractor-rule` is INACTIVE; Okta evaluates it as populating nobody. The parser
    // used to ignore `status` and emit a phantom `populates` edge to Contractors, surfacing as a
    // rule feeding GitHub (granted to Contractors). build-graph now emits no edge for it.
    const ruleNames = traceApp(realStateGraph(), "GitHub").populatingRules.map((r) => r.name);
    expect(ruleNames).not.toContain("inactive-contractor-rule");
  });

  it("M12: the tfstate and live graphs agree on App count (equivalence restored)", () => {
    // The junk okta_app_user App node used to make the tfstate graph report one more app than
    // the live snapshot for the same tenant — the M2 equivalence oracle, broken by the seed.
    expect(summarize(realStateGraph()).apps).toBe(summarize(realLiveGraph()).apps);
  });
});

describe("M13 — greened red (was M11 Phase D `it.fails`; now passes via the directApps resolver)", () => {
  it("M13: user trace includes individually-assigned apps (Salesforce via okta_app_user)", () => {
    // test.user is only in Engineering, which does NOT grant Salesforce. Salesforce is reachable
    // solely through the individual okta_app_user assignment. M12 COUNTS+surfaces it (never
    // dropped); M13 folds it into the per-user trace via the state `directApps` resolver — the
    // static twin of the live per-app `scope: USER` check. Ground truth: 5 apps incl. Salesforce.
    const graph = realStateGraph();
    const directApps = resolveUserDirectAppsFromState(realStateResources(), graph, TEST_USER.id);
    const ut = traceUser(graph, { user: TEST_USER, groupIds: [ENGINEERING] }, { directApps });

    const appNames = ut.apps.map((a) => a.name);
    expect(appNames).toContain("Salesforce");
    expect(appNames).toHaveLength(REAL_APP_LABELS.length);
    // Provenance stays honest: Salesforce is on the separate individual-assignment channel, not
    // attributed to any group (Engineering does not grant it).
    expect(ut.individualApps.map((a) => a.name)).toEqual(["Salesforce"]);
    expect(ut.viaGroups.flatMap((g) => g.apps.map((a) => a.name))).not.toContain("Salesforce");
  });
});

describe("M14 — armed red (expected-fail until the Phase D fixture flip)", () => {
  it.fails(
    "M14: absorbed plural click-ops pair (Confluence/Contractors) is managed AND annotated viaPluralResource",
    () => {
      // Ground truth AFTER a post-click-ops state re-export: `okta_app_group_assignments` re-reads
      // ALL of Confluence's live groups on refresh (the CLAUDE.md gotcha), so the click-ops
      // Contractors→Confluence assignment is absorbed into state and reported `managed` — and Phase A's
      // provenance flag tags it `viaPluralResource` so the absorption is annotated, not silent.
      //
      // Expected-fail on TWO counts until Phase D lands the re-exported fixtures + code together:
      //   - committed fixtures today: the pair is `unmanaged` (state's plural block holds only
      //     Engineering) — see the documenting test below.
      //   - fixtures-without-code: it would be `managed` but UNFLAGGED.
      // Greens only when the re-export makes it `managed` AND Phase A's flag rides through. Delete
      // the `.fails` marker then (move to a greened-reds block).
      const cov = computeCoverage(realLiveResources(), realStateResources());
      const pair = cov.items.find(
        (i) => i.kind === "AppGroupAssignment" && i.name === "Confluence / Contractors",
      );
      expect(pair?.bucket).toBe("managed");
      expect(pair?.viaPluralResource).toBe(true);
    },
  );
});

describe("M11 Phase D — predictions that did NOT reproduce (closed; see PLAN Phase D)", () => {
  it("has no okta_app_access_policy_assignment — protects comes from inline authentication_policy", () => {
    // Prediction #2 (missed `protects` edge) can't reproduce here: this tenant attaches app
    // auth policies via the inline `authentication_policy` attribute, which the parser already
    // reads, not via the standalone okta_app_access_policy_assignment resource. Assert the
    // fixture shape so a future regeneration that adds that resource re-opens the question.
    const state = loadRealStateJson() as {
      values: { root_module: { resources: { type: string }[] } };
    };
    const types = state.values.root_module.resources.map((r) => r.type);
    expect(types).not.toContain("okta_app_access_policy_assignment");

    // The inline path IS exercised: Strict-Auth protects Confluence (proves protects works here).
    expect(traceApp(realStateGraph(), "Confluence").authPolicy?.name).toBe("Strict-Auth");
  });

  it("captures contain no built-in APPS, and built-in GROUPS are correctly excluded (not gaps)", () => {
    // Prediction #5 (built-ins reported as coverage gaps) can't reproduce: the live capture
    // returned only the 5 managed OIDC apps (Admin Console / Dashboard / Browser Plugin appear
    // only as ACCESS_POLICY objects, not as apps). And the built-in GROUPS that DO appear live
    // (Everyone, Okta Administrators) are already correctly `excluded`, never `unmanaged`.
    const cov = computeCoverage(realLiveResources(), realStateResources());

    const unmanagedApps = cov.items.filter((i) => i.kind === "App" && i.bucket === "unmanaged");
    expect(unmanagedApps).toHaveLength(0); // no built-in app misreported as an IaC gap

    const builtInGroups = cov.items.filter(
      (i) => i.kind === "Group" && (i.name === "Everyone" || i.name === "Okta Administrators"),
    );
    expect(builtInGroups).toHaveLength(2);
    expect(builtInGroups.every((g) => g.bucket === "excluded")).toBe(true);
  });

  it("plural-sourced click-ops drift is CAUGHT as unmanaged here, not silently absorbed", () => {
    // Prediction #6 (plural okta_app_group_assignments absorbs drift -> silent 100% managed)
    // does NOT reproduce with the committed fixtures. The click-ops Contractors group added to
    // Confluence is present LIVE but the committed sanitized state's plural block holds only
    // Engineering, so coverage flags Confluence/Contractors as `unmanaged` — the opposite of the
    // predicted absorption. The M14 silent-absorption red needs a state RE-EXPORT taken after the
    // click-ops add (the plural resource reads ALL live groups on refresh). See PLAN Phase D note.
    const cov = computeCoverage(realLiveResources(), realStateResources());
    const confContractors = cov.items.find(
      (i) => i.kind === "AppGroupAssignment" && i.name === "Confluence / Contractors",
    );
    expect(confContractors?.bucket).toBe("unmanaged");
  });
});
