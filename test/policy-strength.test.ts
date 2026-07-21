/**
 * policy-strength oracle — the weakest-ALLOW FLOOR model (Phase 0 decision D1).
 *
 * Property rows prove the ordering the milestone promises: phishing-resistant 2FA > 2FA > 1FA;
 * DENY dominates (all-DENY = strongest) but never RAISES the floor; INACTIVE rules are excluded
 * (M12); priority does NOT pick the effective rule (the floor is the weakest ALLOW regardless of
 * priority — priority only breaks evidence-citation ties); and an unclassifiable rule yields
 * `unknown`, never a guess. Fixture-locked rows tie the model to the capture-verified real shapes.
 */

import { describe, expect, it } from "vitest";
import type { ParsedResource, RuleConstraint } from "../src/core/parse-tfstate.js";
import {
  compareBands,
  computePolicyStrength,
  policyStrengthIndex,
  strengthForPolicy,
} from "../src/analysis/policy-strength.js";
import { realLiveResources, realStateResources } from "./fixture.js";

type PolicyRule = Extract<ParsedResource, { kind: "AppAuthPolicyRule" }>;

/** Build one ALLOW rule with sane defaults; overrides win, `kind` is pinned. */
function mkRule(over: Partial<PolicyRule> & { id: string; policyId: string }): PolicyRule {
  return {
    name: over.id,
    address: `okta_app_signon_policy_rule.${over.id}`,
    access: "ALLOW",
    constraints: [],
    ...over,
    kind: "AppAuthPolicyRule",
  };
}

const PHISHING_RESISTANT: RuleConstraint = { possession: { phishingResistant: "REQUIRED" } };
const HARDWARE_PROTECTED: RuleConstraint = { possession: { hardwareProtection: "REQUIRED" } };

/** Band of a single policy built from `rules`. */
function band(rules: PolicyRule[]): string {
  return computePolicyStrength("p", rules).band;
}

describe("computePolicyStrength — the factor ordering (phishing-resistant 2FA > 2FA > 1FA)", () => {
  it("classifies 1FA as single-factor", () => {
    expect(band([mkRule({ id: "r", policyId: "p", factorMode: "1FA" })])).toBe("single-factor");
  });

  it("classifies plain 2FA (no phishing-resistant constraint) as two-factor", () => {
    expect(band([mkRule({ id: "r", policyId: "p", factorMode: "2FA" })])).toBe("two-factor");
    // a 2FA rule whose only constraint is device-bound (NOT phishing-resistant) is still two-factor
    expect(
      band([
        mkRule({
          id: "r",
          policyId: "p",
          factorMode: "2FA",
          constraints: [{ possession: { deviceBound: "REQUIRED" } }],
        }),
      ]),
    ).toBe("two-factor");
  });

  it("promotes 2FA to phishing-resistant-2fa on a phishingResistant OR hardwareProtection REQUIRED", () => {
    expect(
      band([mkRule({ id: "r", policyId: "p", factorMode: "2FA", constraints: [PHISHING_RESISTANT] })]),
    ).toBe("phishing-resistant-2fa");
    // hardware protection alone is sufficient (fact-table row 4: "phishingResistant OR hardwareProtection")
    expect(
      band([mkRule({ id: "r", policyId: "p", factorMode: "2FA", constraints: [HARDWARE_PROTECTED] })]),
    ).toBe("phishing-resistant-2fa");
  });

  it("orders the three bands strongest→weakest via compareBands", () => {
    expect(compareBands("phishing-resistant-2fa", "two-factor")).toBe("stronger");
    expect(compareBands("two-factor", "single-factor")).toBe("stronger");
    expect(compareBands("single-factor", "phishing-resistant-2fa")).toBe("weaker");
    expect(compareBands("two-factor", "two-factor")).toBe("same");
  });
});

describe("computePolicyStrength — the FLOOR is the weakest ALLOW", () => {
  it("takes the weakest ALLOW across rules (the Strict-Auth kicker: a 1FA bypass floors a strong policy)", () => {
    // A policy that requires phishing-resistant 2FA for everyone EXCEPT a 1FA contractor bypass
    // floors at single-factor — the weakest documented way in.
    const s = computePolicyStrength("p", [
      mkRule({ id: "strong", policyId: "p", name: "Require-PR", factorMode: "2FA", constraints: [PHISHING_RESISTANT] }),
      mkRule({ id: "bypass", policyId: "p", name: "Contractor-Bypass", factorMode: "1FA" }),
    ]);
    expect(s.band).toBe("single-factor");
    expect(s.evidence?.ruleName).toBe("Contractor-Bypass"); // cites the deciding (weakest) rule
    expect(s.ordinal).toBe(1);
  });

  it("cites the deciding rule's SCOPE so the floor stays honest (a group/network-scoped bypass)", () => {
    const s = computePolicyStrength("p", [
      mkRule({ id: "strong", policyId: "p", factorMode: "2FA", constraints: [PHISHING_RESISTANT] }),
      mkRule({
        id: "bypass",
        policyId: "p",
        factorMode: "1FA",
        groupsIncluded: ["g-contractors"],
        networkConnection: "ANYWHERE",
      }),
    ]);
    expect(s.evidence).toMatchObject({
      ruleId: "bypass",
      access: "ALLOW",
      factorMode: "1FA",
      groupsIncluded: ["g-contractors"],
      networkConnection: "ANYWHERE",
    });
  });
});

describe("computePolicyStrength — DENY", () => {
  it("bands an all-DENY policy as deny-all (strongest), citing a DENY rule", () => {
    const s = computePolicyStrength("p", [
      mkRule({ id: "d1", policyId: "p", name: "Block-Off-Net", access: "DENY", factorMode: undefined }),
    ]);
    expect(s.band).toBe("deny-all");
    expect(s.ordinal).toBe(4);
    expect(s.evidence).toMatchObject({ ruleId: "d1", access: "DENY" });
    expect(compareBands("deny-all", "phishing-resistant-2fa")).toBe("stronger");
  });

  it("does NOT let a DENY rule raise the floor (deny + 1FA allow => single-factor)", () => {
    const s = computePolicyStrength("p", [
      mkRule({ id: "d", policyId: "p", access: "DENY" }),
      mkRule({ id: "a", policyId: "p", factorMode: "1FA" }),
    ]);
    expect(s.band).toBe("single-factor");
    expect(s.denyRuleCount).toBe(1);
    expect(s.allowRuleCount).toBe(1);
  });
});

describe("computePolicyStrength — INACTIVE excluded (M12 rule)", () => {
  it("ignores an INACTIVE 1FA rule so an active-2FA policy stays two-factor", () => {
    const s = computePolicyStrength("p", [
      mkRule({ id: "on", policyId: "p", factorMode: "2FA" }),
      mkRule({ id: "off", policyId: "p", factorMode: "1FA", status: "INACTIVE" }),
    ]);
    expect(s.band).toBe("two-factor");
    expect(s.activeRuleCount).toBe(1);
  });

  it("is unknown when the only rules are INACTIVE (nothing readable and active)", () => {
    expect(band([mkRule({ id: "off", policyId: "p", factorMode: "1FA", status: "INACTIVE" })])).toBe("unknown");
  });
});

describe("computePolicyStrength — priority does NOT pick the effective rule (D1)", () => {
  it("floors at the weakest ALLOW even when a STRONGER rule is evaluated first (lower priority)", () => {
    // priority 0 (first-evaluated) requires phishing-resistant 2FA; priority 5 allows 1FA.
    // A "priority picks the winner" model would return phishing-resistant-2fa; the FLOOR model does not.
    const s = computePolicyStrength("p", [
      mkRule({ id: "first", policyId: "p", priority: 0, factorMode: "2FA", constraints: [PHISHING_RESISTANT] }),
      mkRule({ id: "later", policyId: "p", priority: 5, factorMode: "1FA" }),
    ]);
    expect(s.band).toBe("single-factor");
    expect(s.evidence?.ruleId).toBe("later");
  });

  it("uses priority only to break evidence-citation ties among equally-weak rules", () => {
    // two 1FA rules — the floor is single-factor either way; cite the lower-priority (first-evaluated) one.
    const s = computePolicyStrength("p", [
      mkRule({ id: "hi", policyId: "p", priority: 9, factorMode: "1FA" }),
      mkRule({ id: "lo", policyId: "p", priority: 1, factorMode: "1FA" }),
    ]);
    expect(s.band).toBe("single-factor");
    expect(s.evidence?.ruleId).toBe("lo");
  });
});

describe("computePolicyStrength — unknown is never a guess", () => {
  it("returns unknown for an unrecognized factorMode (Identity-Engine variance)", () => {
    const s = computePolicyStrength("p", [mkRule({ id: "r", policyId: "p", factorMode: "SOME_NEW_MODE" })]);
    expect(s.band).toBe("unknown");
    expect(s.ordinal).toBeNull();
    expect(s.evidence).toBeNull();
  });

  it("classifies 2FA_If_Possible as single-factor (conservative fallback, Phase 0 addendum)", () => {
    expect(band([mkRule({ id: "r", policyId: "p", factorMode: "2FA_If_Possible" })])).toBe("single-factor");
  });

  it("returns unknown for an empty rule set", () => {
    expect(band([])).toBe("unknown");
  });

  it("an unclassifiable ALLOW rule forces unknown UNLESS a proven single-factor floor already exists", () => {
    // {2FA, unknown} -> unknown: the unknown rule could be a weaker way in than two-factor.
    expect(
      band([
        mkRule({ id: "a", policyId: "p", factorMode: "2FA" }),
        mkRule({ id: "b", policyId: "p", factorMode: "WEIRD" }),
      ]),
    ).toBe("unknown");
    // {1FA, unknown} -> single-factor: nothing is weaker than single-factor for the unknown to hide.
    expect(
      band([
        mkRule({ id: "a", policyId: "p", factorMode: "1FA" }),
        mkRule({ id: "b", policyId: "p", factorMode: "WEIRD" }),
      ]),
    ).toBe("single-factor");
  });

  it("compareBands is incomparable whenever either side is unknown", () => {
    expect(compareBands("unknown", "single-factor")).toBe("incomparable");
    expect(compareBands("deny-all", "unknown")).toBe("incomparable");
    expect(compareBands("unknown", "unknown")).toBe("incomparable");
  });
});

describe("policyStrengthIndex / strengthForPolicy", () => {
  it("groups rules by policyId and bands each policy independently", () => {
    const idx = policyStrengthIndex([
      mkRule({ id: "r1", policyId: "weak", factorMode: "1FA" }),
      mkRule({ id: "r2", policyId: "strong", factorMode: "2FA", constraints: [PHISHING_RESISTANT] }),
    ]);
    expect(idx.get("weak")?.band).toBe("single-factor");
    expect(idx.get("strong")?.band).toBe("phishing-resistant-2fa");
  });

  it("treats a policy with no captured rules as unknown (never a guess)", () => {
    const idx = policyStrengthIndex([]);
    expect(idx.has("absent")).toBe(false);
    expect(strengthForPolicy(idx, "absent")).toMatchObject({ band: "unknown", ordinal: null, evidence: null });
  });
});

// ── Fixture-locked: bands match the capture-verified real shapes (Phase 0 live confirmation) ──────
describe("policy-strength — real capture (Strict-Auth vs org-default 'Any two factors')", () => {
  const STRICT = "rst12872f333b6350610"; // "Strict-Auth"
  const ORG_DEFAULT = "rst16ffbd575c05d891c"; // "Any two factors" (system org-default)

  it("bands Strict-Auth single-factor on the LIVE path, citing the Contractors 1FA bypass", () => {
    const s = strengthForPolicy(policyStrengthIndex(realLiveResources()), STRICT);
    expect(s.band).toBe("single-factor");
    expect(s.evidence).toMatchObject({ ruleName: "Contractors-Password-Bypass", factorMode: "1FA" });
  });

  it("bands Strict-Auth single-factor on the tfstate path too — the managed bypass sets the floor", () => {
    // Even without the (unmanaged, live-only) catch-all, the captured Contractors rule floors it.
    const s = strengthForPolicy(policyStrengthIndex(realStateResources()), STRICT);
    expect(s.band).toBe("single-factor");
    expect(s.evidence?.ruleName).toBe("Contractors-Password-Bypass");
  });

  it("bands the org-default 'Any two factors' two-factor LIVE, but unknown in tfstate (catch-all divergence)", () => {
    const live = strengthForPolicy(policyStrengthIndex(realLiveResources()), ORG_DEFAULT);
    expect(live.band).toBe("two-factor");
    // tfstate has only the unmanaged system catch-all for this policy => no captured rules => unknown.
    const state = strengthForPolicy(policyStrengthIndex(realStateResources()), ORG_DEFAULT);
    expect(state.band).toBe("unknown");
  });

  it("the Phase 0 KICKER: Strict-Auth floors WEAKER than the org default (the org-default-is-looser prior, inverted)", () => {
    const idx = policyStrengthIndex(realLiveResources());
    const strict = strengthForPolicy(idx, STRICT).band;
    const orgDefault = strengthForPolicy(idx, ORG_DEFAULT).band;
    expect(compareBands(strict, orgDefault)).toBe("weaker");
  });
});
