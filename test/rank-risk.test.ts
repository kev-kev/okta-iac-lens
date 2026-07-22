/**
 * rankRisk oracle — the opinionated ranking (reach × gate × IaC). Uses the shared fixture for
 * reach/gate, and computeCoverage(live, state) for the IaC signal. Coverage cases enrich in-test
 * COPIES of the live records (never mutate the shared fixtures).
 *
 * Fixture facts: GitHub (a-gh) granted by Engineering + Contractors (reach 2), org-default gate
 * (WEAK). Datadog (a-dd) granted by Engineering only (reach 1), Strict-Auth custom gate (STRONG).
 * Engineering (g-eng) grants 2 apps, has Default-MFA session policy (STRONG). Contractors (g-con)
 * grants 1 app, no session policy (WEAK).
 */

import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/build-graph.js";
import type { ParsedResource, RuleConstraint } from "../src/core/parse-tfstate.js";
import { computeCoverage } from "../src/analysis/coverage.js";
import { rankRisk } from "../src/analysis/rank-risk.js";
import { strengthResolver } from "../src/analysis/policy-strength.js";
import { renderRisk } from "../src/render/cli.js";
import { graphFromFixture, liveResources, stateResources } from "./fixture.js";
import { syntheticGraph } from "./synthetic.js";

const byId = (rows: ReturnType<typeof rankRisk>, id: string) => rows.find((r) => r.id === id)!;

/**
 * A synthetic org for M16 band scoring: one shared group grants five apps of equal reach (1),
 * each gated by a distinct custom policy whose captured rule(s) produce a specific band —
 * single-factor / two-factor / phishing-resistant / deny-all / unknown (a custom policy with no
 * captured rules). Built as resources so `strengthResolver` bands them from real rule records.
 */
function bandFixture(): ParsedResource[] {
  const app = (id: string, policyId: string): ParsedResource => ({
    kind: "App",
    id,
    name: id,
    appType: "okta_app_oauth",
    address: `okta_app_oauth.${id}`,
    authenticationPolicyId: policyId,
  });
  const policy = (id: string): ParsedResource => ({
    kind: "AppAuthPolicy",
    id,
    name: id,
    address: `okta_app_signon_policy.${id}`,
  });
  const grant = (appId: string): ParsedResource => ({
    kind: "AppGroupAssignment",
    address: `okta_app_group_assignment.${appId}`,
    appId,
    groupId: "g1",
  });
  const rule = (
    policyId: string,
    over: { access?: string; factorMode?: string; constraints?: RuleConstraint[] },
  ): ParsedResource => ({
    kind: "AppAuthPolicyRule",
    id: `${policyId}-r`,
    policyId,
    name: `${policyId}-r`,
    address: `okta_app_signon_policy_rule.${policyId}-r`,
    access: over.access ?? "ALLOW",
    factorMode: over.factorMode,
    constraints: over.constraints ?? [],
  });
  const PHISHING_RESISTANT: RuleConstraint = { possession: { phishingResistant: "REQUIRED" } };

  return [
    { kind: "Group", id: "g1", name: "All", address: "okta_group.g1" },
    app("a-1fa", "pol-1fa"), policy("pol-1fa"), grant("a-1fa"), rule("pol-1fa", { factorMode: "1FA" }),
    app("a-2fa", "pol-2fa"), policy("pol-2fa"), grant("a-2fa"), rule("pol-2fa", { factorMode: "2FA" }),
    app("a-pr", "pol-pr"), policy("pol-pr"), grant("a-pr"),
    rule("pol-pr", { factorMode: "2FA", constraints: [PHISHING_RESISTANT] }),
    app("a-deny", "pol-deny"), policy("pol-deny"), grant("a-deny"), rule("pol-deny", { access: "DENY" }),
    // a custom policy with NO captured rules → unknown band → neutral weight
    app("a-unk", "pol-unk"), policy("pol-unk"), grant("a-unk"),
  ];
}

describe("rankRisk — reach × gate (no coverage)", () => {
  const rows = rankRisk(graphFromFixture());

  it("scores GitHub (reach 2, weak gate) above Datadog (reach 1, strong gate)", () => {
    expect(byId(rows, "a-gh").score).toBeGreaterThan(byId(rows, "a-dd").score);
    expect(rows[0].id).toBe("a-gh"); // widest reach behind the weakest gate leads
  });

  it("labels each signal legibly on the row", () => {
    const gh = byId(rows, "a-gh");
    expect(gh).toMatchObject({ kind: "App", reach: 2, gate: "org-default", gatePrior: "default" });
    const dd = byId(rows, "a-dd");
    expect(dd).toMatchObject({ reach: 1, gate: "custom", gatePrior: "custom" });
    const eng = byId(rows, "g-eng");
    expect(eng).toMatchObject({ kind: "Group", reach: 2, gate: "session-policy", gatePrior: "custom" });
    const con = byId(rows, "g-con");
    expect(con).toMatchObject({ reach: 1, gate: "none", gatePrior: "default" });
  });

  it("marks IaC status 'unknown' and neutralizes its weight when no coverage is supplied", () => {
    expect(rows.every((r) => r.iac === "unknown")).toBe(true);
    // GitHub: reach 2 × weak(2) × unknown(1) = 4; Datadog: reach 1 × strong(1) × unknown(1) = 1.
    expect(byId(rows, "a-gh").score).toBe(4);
    expect(byId(rows, "a-dd").score).toBe(1);
  });

  it("ranks apps and groups together, highest score first", () => {
    const scores = rows.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("rankRisk — with coverage, the IaC weight lifts an unmanaged resource", () => {
  // Slack: same shape as GitHub (reach 2, org-default/weak) but live-only ⇒ unmanaged.
  const slack: ParsedResource = {
    kind: "App",
    id: "a-slack",
    name: "Slack",
    appType: "okta_app_oauth",
    address: "x",
    authenticationPolicyId: null,
  };
  const slackEng: ParsedResource = { kind: "AppGroupAssignment", address: "x", appId: "a-slack", groupId: "g-eng" };
  const slackCon: ParsedResource = { kind: "AppGroupAssignment", address: "x", appId: "a-slack", groupId: "g-con" };

  const live = [...liveResources(), slack, slackEng, slackCon];
  const graph = buildGraph(live);
  const coverage = computeCoverage(live, stateResources());
  const rows = rankRisk(graph, coverage);

  it("Slack outranks GitHub purely on IaC status (identical reach + gate, but unmanaged)", () => {
    const slackRow = byId(rows, "a-slack");
    const gh = byId(rows, "a-gh");
    expect(slackRow.iac).toBe("unmanaged");
    expect(gh.iac).toBe("managed");
    expect(slackRow.reach).toBe(gh.reach); // same reach
    expect(slackRow.gatePrior).toBe(gh.gatePrior); // same gate
    expect(slackRow.score).toBeGreaterThan(gh.score); // …but unmanaged compounds
    expect(rows[0].id).toBe("a-slack"); // widest reach, weakest gate, NOT in Terraform → first
  });

  it("managed resources carry their real bucket, not 'unknown'", () => {
    expect(byId(rows, "a-dd").iac).toBe("managed");
  });
});

describe("renderRisk", () => {
  const rows = rankRisk(graphFromFixture());

  it("text: ranked rows with the signal columns, highest risk first", () => {
    const text = renderRisk(rows, "text");
    expect(text).toContain("widest reach × weakest gate × not-in-Terraform first");
    const lines = text.split("\n");
    const gh = lines.findIndex((l) => l.includes("GitHub"));
    const dd = lines.findIndex((l) => l.includes("Datadog"));
    expect(gh).toBeGreaterThan(-1);
    expect(gh).toBeLessThan(dd); // GitHub ranked above Datadog
    expect(lines[gh]).toContain("org-default (default)");
    expect(lines[gh]).toContain("n/a"); // no coverage supplied
  });

  it("text: prints the 'prior, not proof' gate caveat so the honesty note can't regress", () => {
    const text = renderRisk(rows, "text");
    expect(text).toContain("gate strength is a heuristic prior");
    expect(text).toContain("not a proven weakness");
  });

  it("json: preserves the ranked order", () => {
    const parsed = JSON.parse(renderRisk(rows, "json"));
    expect(parsed[0].id).toBe("a-gh");
    expect(parsed.map((r: { score: number }) => r.score)).toEqual(rows.map((r) => r.score));
  });
});

describe("rankRisk — scale (must stay O(N+E), not per-subject-in-a-loop)", () => {
  it("ranks a 15k-node / 60k-edge synthetic org well within a smoke bound", () => {
    const graph = syntheticGraph(); // 10k groups + 5k apps + 60k grants + hubs
    const t0 = performance.now();
    const rows = rankRisk(graph);
    const ms = performance.now() - t0;

    const appsAndGroups = graph.nodes.filter((n) => n.kind === "App" || n.kind === "Group").length;
    expect(rows).toHaveLength(appsAndGroups);
    // The hub group g0 (grants 800 apps) has the widest reach → tops the ranking (weak gate too).
    expect(rows[0].id).toBe("g0");
    expect(rows[0].reach).toBeGreaterThanOrEqual(800);
    // Generous bound: O(N+E) finishes in a few ms; the old O(N×E) loop took ~30s.
    expect(ms).toBeLessThan(1000);
  });
});

describe("rankRisk — band-aware gate scoring (M16)", () => {
  const resources = bandFixture();
  const graph = buildGraph(resources);
  const resolver = strengthResolver(resources);
  const ranked = rankRisk(graph, undefined, resolver);
  const scoreOf = (id: string) => byId(ranked, id).score;

  it("weighs each App gate by its captured band: single(4) > two(2) > phishing(1) > deny(0)", () => {
    // reach 1 each, no coverage ⇒ score IS the gate multiplier.
    expect(scoreOf("a-1fa")).toBe(4); // single-factor
    expect(scoreOf("a-2fa")).toBe(2); // two-factor
    expect(scoreOf("a-pr")).toBe(1); // phishing-resistant-2fa
    expect(scoreOf("a-deny")).toBe(0); // deny-all → floored
    // the locked invariant: strictly monotonic in band strength (weaker ⇒ higher risk).
    expect(scoreOf("a-1fa")).toBeGreaterThan(scoreOf("a-2fa"));
    expect(scoreOf("a-2fa")).toBeGreaterThan(scoreOf("a-pr"));
    expect(scoreOf("a-pr")).toBeGreaterThan(scoreOf("a-deny"));
  });

  it("scores an unknown band (custom policy, no captured rules) NEUTRAL — equal to two-factor", () => {
    expect(scoreOf("a-unk")).toBe(2);
    expect(scoreOf("a-unk")).toBe(scoreOf("a-2fa"));
  });

  it("makes deny-all the minimum gate weight (a fully-denied gate carries no exposure)", () => {
    const appScores = ranked.filter((r) => r.kind === "App").map((r) => r.score);
    expect(Math.min(...appScores)).toBe(0);
    expect(scoreOf("a-deny")).toBe(0);
  });

  it("falls back to the prior WITHOUT a resolver (all custom-gated ⇒ 1× ⇒ score = reach)", () => {
    const prior = rankRisk(graph); // no resolver
    expect(byId(prior, "a-1fa").score).toBe(1);
    expect(byId(prior, "a-deny").score).toBe(1);
    // and band scoring genuinely moved things: 1FA lifted above the prior, deny dropped below it.
    expect(scoreOf("a-1fa")).toBeGreaterThan(byId(prior, "a-1fa").score);
    expect(scoreOf("a-deny")).toBeLessThan(byId(prior, "a-deny").score);
  });

  it("does NOT touch GROUP scores — session gates keep the prior (S1 / D2)", () => {
    const withResolver = byId(ranked, "g1").score;
    const withoutResolver = byId(rankRisk(graph), "g1").score;
    expect(withResolver).toBe(withoutResolver);
    // g1 grants 5 apps (reach 5), no session policy ⇒ prior 'default' (2×) ⇒ 10, both ways.
    expect(withResolver).toBe(10);
  });
});
