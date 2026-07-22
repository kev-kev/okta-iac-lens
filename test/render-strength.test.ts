/**
 * M15 Phase D — the JSON structured verdicts + the web strength-note regime.
 *
 * The text `↳` verdict and the `band` column were locked in Phase C (expected-red.test.ts). Phase D
 * adds the machine-readable twins (`outliers --json`, `risk --json`) and the web caveat regime. All
 * flow through the SAME shared helpers, so these tests guard the serialized contract + the honest
 * caveat, not a second computation.
 */

import { describe, expect, it } from "vitest";
import { findPolicyOutliers } from "../src/analysis/policy-outliers.js";
import { rankRisk } from "../src/analysis/rank-risk.js";
import { strengthResolver } from "../src/analysis/policy-strength.js";
import { renderOutliers, renderRisk } from "../src/render/cli.js";
import { outlierStrengthNote, verdictRegime } from "../src/render/web/strength-notes.js";
import { realLiveGraph, realLiveResources } from "./fixture.js";

describe("renderOutliers --json — structured verdicts (M15 Phase D)", () => {
  const graph = realLiveGraph();
  const report = findPolicyOutliers(graph);
  const strength = strengthResolver(realLiveResources());

  it("attaches a strength block whose GitHub row inverts the prior (grounded, stronger)", () => {
    const json = JSON.parse(renderOutliers(report, "json", strength));
    expect(json.rows).toBeDefined(); // the base report is preserved
    const ghId = report.rows.find((r) => r.appName === "GitHub")!.appId;
    const gh = json.strength.rows.find((r: { appId: string }) => r.appId === ghId);
    // GitHub's own gate is the org default → two-factor (captured); the peer-dominant Strict-Auth
    // floors single-factor. So the verdict is GROUNDED and STRONGER — the prior inverted.
    expect(gh.subject.band).toBe("two-factor");
    const grounded = gh.findings.find((f: { grounded: boolean }) => f.grounded);
    expect(grounded.direction).toBe("stronger");
    expect(grounded.baseline.band).toBe("single-factor");
    expect(grounded.baseline.evidence.ruleName).toBe("Contractors-Password-Bypass");
  });

  it("omits the strength block entirely when no resolver is supplied (priors only)", () => {
    const json = JSON.parse(renderOutliers(report, "json"));
    expect(json.strength).toBeUndefined();
    expect(json.rows).toBeDefined();
  });
});

describe("renderRisk --json — captured band per App row (M15 Phase D)", () => {
  const strength = strengthResolver(realLiveResources());
  const rows = rankRisk(realLiveGraph(), undefined, strength);

  it("stamps each App row's gate band (the kicker: org-default 2FA, custom-gated 1FA)", () => {
    const json = JSON.parse(renderRisk(rows, "json", strength));
    const gh = json.find((r: { name: string }) => r.name === "GitHub");
    const conf = json.find((r: { name: string }) => r.name === "Confluence");
    expect(gh.band).toBe("two-factor"); // org-default gate
    expect(conf.band).toBe("single-factor"); // Strict-Auth gate
    // M16: the score weighs the band, so the 1FA custom gate outranks the 2FA org-default.
    expect(conf.score).toBeGreaterThan(gh.score);
  });

  it("carries no band when no resolver is supplied", () => {
    const json = JSON.parse(renderRisk(rows, "json"));
    expect(json.find((r: { name: string }) => r.name === "GitHub").band).toBeUndefined();
  });

  it("never bands a Group row (session-gate strength is M15-deferred, D2)", () => {
    const json = JSON.parse(renderRisk(rows, "json", strength));
    for (const r of json) if (r.kind === "Group") expect(r.band).toBeUndefined();
  });
});

describe("strength-notes — the web caveat regime (anti-overclaim)", () => {
  it("picks the regime from (has resolver, any grounded)", () => {
    expect(verdictRegime(false, false)).toBe("prior");
    expect(verdictRegime(true, true)).toBe("grounded");
    expect(verdictRegime(true, false)).toBe("all-unknown");
  });

  it("keeps the stale prior phrase ONLY on prior/all-unknown surfaces, never on grounded ones", () => {
    // The prior surface must still carry the recognizable caveat (Phase E: don't remove it there).
    expect(outlierStrengthNote("prior")).toMatch(/heuristic prior/);
    expect(outlierStrengthNote("prior")).toMatch(/not a factor-based verdict/);
    // all-unknown is honestly still a prior — the phrase is allowed.
    expect(outlierStrengthNote("all-unknown")).toMatch(/heuristic prior/);
    // grounded reads policy contents — the "not a factor-based verdict" claim would be a lie.
    expect(outlierStrengthNote("grounded")).not.toMatch(/not a factor-based verdict/);
    expect(outlierStrengthNote("grounded")).toMatch(/grounded/);
  });
});
