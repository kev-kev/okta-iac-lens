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

describe("M11 Phase D — reproduced reds (flip to green at the named milestone)", () => {
  it.fails(
    "M12: okta_app_* lookalikes must NOT become App nodes (okta_app_user is not an app)",
    () => {
      const appIds = realStateGraph()
        .nodes.filter((n) => n.kind === "App")
        .map((n) => n.id);
      // The seed's okta_app_user (test user -> Salesforce) currently slips through the
      // narrow APP_TYPE_DENYLIST and becomes a junk App node with an empty name. M12's
      // ALLOWLIST fixes this. Ground truth: exactly the 5 managed apps, no user id.
      expect(appIds).not.toContain(APP_USER_ID);
      expect(appIds).toHaveLength(REAL_APP_LABELS.length);
    },
  );

  it.fails(
    "M12: the junk App node must not appear as a phantom `stale` App in coverage",
    () => {
      const cov = computeCoverage(realLiveResources(), realStateResources());
      const staleApps = cov.items.filter((i) => i.kind === "App" && i.bucket === "stale");
      // The okta_app_user junk node is state-only (live has no such app), so today it is
      // misreported as a `stale` App — a deleted-out-of-band false positive. M12 allowlist.
      expect(staleApps).toHaveLength(0);
    },
  );

  it.fails(
    "M12: session policy for a group must be chosen by priority, not tfstate address order",
    () => {
      // Two okta_policy_signon both include Engineering: Stricter-Session (priority 1) and
      // Default-MFA (priority 2). Okta evaluates priority 1 first -> Stricter-Session wins.
      // The tfstate path takes the first `appliesTo` edge (address order) -> Default-MFA. Wrong.
      const picked = trace(realStateGraph(), "Engineering").globalSessionPolicy?.name;
      expect(picked).toBe("Stricter-Session");
    },
  );

  it.fails(
    "M12: an INACTIVE group rule must populate no one (status is not evaluated today)",
    () => {
      // `inactive-contractor-rule` is INACTIVE; Okta evaluates it as populating nobody.
      // The parser ignores `status`, so it emits a phantom `populates` edge to Contractors,
      // which then surfaces as a rule feeding GitHub (granted to Contractors).
      const ruleNames = traceApp(realStateGraph(), "GitHub").populatingRules.map((r) => r.name);
      expect(ruleNames).not.toContain("inactive-contractor-rule");
    },
  );

  it.fails(
    "M12/M13: user trace must include individually-assigned apps (Salesforce via okta_app_user)",
    () => {
      // test.user is only in Engineering, which does NOT grant Salesforce. Salesforce is
      // reachable solely through the individual okta_app_user assignment — an unmodeled
      // channel today, so the group-union trace omits it. Ground truth: 5 apps incl. Salesforce.
      const ut = traceUser(realStateGraph(), { user: TEST_USER, groupIds: [ENGINEERING] });
      const appNames = ut.apps.map((a) => a.name);
      expect(appNames).toContain("Salesforce");
      expect(appNames).toHaveLength(REAL_APP_LABELS.length);
    },
  );

  it.fails(
    "M12: the tfstate and live graphs must agree on App count (equivalence broken by the lookalike)",
    () => {
      // The junk okta_app_user App node makes the tfstate graph report one more app than the
      // live snapshot for the same tenant — the M2 equivalence oracle, broken by the seed.
      expect(summarize(realStateGraph()).apps).toBe(summarize(realLiveGraph()).apps);
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
