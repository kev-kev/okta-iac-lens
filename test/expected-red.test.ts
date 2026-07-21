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
import { generateImportBlocks } from "../src/analysis/import-blocks.js";
import { findPolicyOutliers } from "../src/analysis/policy-outliers.js";
import { rankRisk } from "../src/analysis/rank-risk.js";
import { strengthResolver } from "../src/analysis/policy-strength.js";
import { renderOutliers, renderRisk, renderTrace } from "../src/render/cli.js";
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

describe("M14 — greened red #8 (was Phase B `it.fails`; greened by the Phase D fixture flip)", () => {
  it("M14: absorbed plural click-ops pair (Confluence/Contractors) is managed AND annotated viaPluralResource", () => {
    // Ground truth after the post-click-ops state re-export: `okta_app_group_assignments` re-reads
    // ALL of Confluence's live groups on refresh (the CLAUDE.md gotcha), so the click-ops
    // Contractors→Confluence assignment is absorbed into state and reported `managed`. Phase A's
    // provenance flag tags it `viaPluralResource` so the absorption is ANNOTATED, not silent.
    const cov = computeCoverage(realLiveResources(), realStateResources());
    const pair = cov.items.find(
      (i) => i.kind === "AppGroupAssignment" && i.name === "Confluence / Contractors",
    );
    expect(pair?.bucket).toBe("managed");
    expect(pair?.viaPluralResource).toBe(true);
  });

  it("the absorbed pair emits NO import block — the viaPluralResource flag IS the honest mitigation", () => {
    // Presence-only coverage structurally cannot DETECT drift the plural resource absorbs, so the
    // pair is `managed` and generates no import block (PLAN.md known risk 3). Annotation, not
    // detection, is the deliverable: the flag keeps this from being a silent 100%.
    const cov = computeCoverage(realLiveResources(), realStateResources());
    const pair = cov.items.find(
      (i) => i.kind === "AppGroupAssignment" && i.name === "Confluence / Contractors",
    );
    const tf = generateImportBlocks(cov, realLiveResources());
    // The import id for an app-group assignment is `${appId}/${groupId}` === the coverage item key.
    expect(tf).not.toContain(pair!.key);
  });
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

  // Prediction #6 (plural okta_app_group_assignments absorbs click-ops drift) DID reproduce once
  // the state was re-exported after the click-ops add — it moved out of this "did NOT reproduce"
  // block and greened M14 red #8 above (managed + viaPluralResource, no import block). Its former
  // committed-fixtures assertion (Confluence/Contractors `unmanaged`) is superseded by absorption.
});

describe("M15 Phase C — grounded verdicts delivered (the Phase 0 KICKER, on real surfaces)", () => {
  it("outliers: the org-default outlier now carries a GROUNDED verdict that INVERTS the prior (live)", () => {
    const text = renderOutliers(
      findPolicyOutliers(realLiveGraph()),
      "text",
      strengthResolver(realLiveResources()),
    );
    // GitHub is flagged default-while-peers-custom (prior: org-default is the looser gate). But the
    // ↳ verdict, read from captured rules, says its org-default gate ('Any two factors', two-factor)
    // is STRONGER than the peer-dominant Strict-Auth (single-factor, a 1FA Contractors bypass).
    expect(text).toContain("↳ stronger: org default");
    expect(text).toContain("baseline Strict-Auth admits single-factor (1FA)");
    expect(text).toContain("Contractors-Password-Bypass");
    // Honest scope: the 1FA floor rule is Contractors-scoped — a policy property, not proof every
    // app/user reaches the app at 1FA (Phase 0). The verdict says so instead of over-claiming.
    expect(text).toContain("scoped to 1 group");
  });

  it("outliers: the SAME divergence stays a prior on the tfstate path (org-default band unknown there)", () => {
    // The system org-default's rules are unmanaged (absent from state), so GitHub's band is unknown
    // on tfstate — no grounded verdict is possible and the M13 prior wording is kept VERBATIM.
    const text = renderOutliers(
      findPolicyOutliers(realStateGraph()),
      "text",
      strengthResolver(realStateResources()),
    );
    expect(text).not.toContain("↳");
    expect(text).toContain("gate strength is a heuristic prior");
  });

  it("risk: the band column exposes the kicker — an org-default 2FA gate outscores a 1FA custom gate", () => {
    const text = renderRisk(rankRisk(realLiveGraph()), "text", strengthResolver(realLiveResources()));
    const line = (name: string) => text.split("\n").find((l) => l.includes(name))!;
    expect(line("GitHub")).toContain("2FA"); // org-default gate bands two-factor
    expect(line("Confluence")).toContain("1FA"); // Strict-Auth gate bands single-factor
    expect(text).toContain("band-aware scoring is future work"); // the honest caveat (score red armed)
  });

  it("trace: app auth policy lines carry the captured floor + deciding rule (live)", () => {
    const text = renderTrace(
      trace(realLiveGraph(), "Engineering"),
      "text",
      strengthResolver(realLiveResources()),
    );
    expect(text).toContain("floor: admits single-factor (1FA) [rule 'Contractors-Password-Bypass'");
    expect(text).toContain("floor: requires two-factor (2FA) [rule 'Catch-all Rule']");
  });
});

describe("M15 Phase E — deferred limitation (pinned): gate SCORING keeps the org-default prior the bands invert", () => {
  // Was a Phase C armed `it.fails`. M15's scope (stated three times in PLAN.md) surfaces the captured
  // band as EVIDENCE + a caveat but deliberately does NOT re-weight the risk score — re-scoring from
  // bands is the M16 "band-aware risk scoring" roadmap item. So this fits NEITHER doctrine shape
  // above: the bug reproduces (unlike a documenting test), but the fix is out of THIS milestone's
  // scope (unlike an `it.fails` a same-milestone fix will green). It is a characterization pin of
  // today's prior-based ranking, kept green so M15 closes at 0 expected-fail. The honest band +
  // "band-aware scoring is future work" caveat that keep the risk surface non-misleading are asserted
  // by the sibling "risk: the band column exposes the kicker" test above.
  it("today: rankRisk scores a STRONGER-gated org-default app above a weaker-floored custom peer (prior, not band)", () => {
    // Kicker (live, capture-verified): GitHub's org default 'Any two factors' floors two-factor;
    // Confluence's Strict-Auth floors single-factor (its 1FA Contractors bypass). Equal reach (2)
    // and no coverage, so the score gap is PURELY the gate multiplier. Ground truth (the M16 target):
    // the weaker-floored gate (Confluence, 1FA) is the higher risk. But rankRisk still weights
    // org-default 2x (the M8 prior), so GitHub OUTSCORES Confluence. When M16 scores from bands this
    // pin FLIPS red — update it then to assert the ground-truth ordering (conf.score >= gh.score).
    const rows = rankRisk(realLiveGraph());
    const gh = rows.find((r) => r.name === "GitHub")!;
    const conf = rows.find((r) => r.name === "Confluence")!;
    expect(gh.reach).toBe(conf.reach); // isolate the gate: equal reach
    expect(gh.score).toBeGreaterThan(conf.score); // prior mis-ranks TODAY: 4 > 2 (M16 band-aware flips this)
  });
});
