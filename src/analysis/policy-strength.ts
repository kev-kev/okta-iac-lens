/**
 * policy-strength: app-auth policy RULES -> a per-policy strength BAND with cited evidence.
 *
 * PURE — a consumer of parsed resources only (the `AppAuthPolicyRule` records `parse-tfstate` /
 * `map-api` produce; NOT the graph — rules are policy-internal, see model.ts `NodeKind`). No I/O.
 * This is the M15 payoff: M13 replaced fabricated strength directions with direction-neutral
 * priors; this module reads the rules those priors promised to read, so Phase C can emit grounded
 * verdicts ("weaker: requires 1FA, rule 'X'") wherever rules were captured — and keep the prior
 * wording verbatim wherever they weren't.
 *
 * ── Band model: weakest-ALLOW FLOOR (Phase 0 decision D1, revisitable) ──────────────────────────
 * A policy's band = the WEAKEST assurance any ACTIVE, ALLOW rule permits — the easiest documented
 * way in. This is an honest LOWER BOUND that needs no rule-CONDITION evaluation (we never read the
 * OEL/user/network predicates that decide which rule actually fires for a given user), and it
 * matches the tool's existing "the weakest gate is the effective exposure" stance (policy-outliers).
 *
 *  - DENY rules are recorded (counts + deny-all) but NEVER raise the floor (a DENY is not a "way in").
 *  - `priority` does NOT pick a single winning rule — that would need the conditions we don't read.
 *    It only breaks evidence-citation ties among equally-weak rules (Okta evaluates lowest-priority
 *    number first; the system catch-all is always the highest number). This deliberately DEVIATES
 *    from the superseded "priority picks the effective rule" wording — see D1 in PLAN.md.
 *  - The floor is a POLICY property, not proof every app/user is reachable at that band: the
 *    deciding rule may be scoped to a group / network zone. Evidence therefore carries that SCOPE
 *    (`groupsIncluded` / `networkConnection`) so Phase C verdicts stay honest without evaluating it.
 *  - `unknown` is never a guess: no readable ACTIVE rules, or an unclassifiable ALLOW rule that
 *    could be a weaker way in than anything we can classify, yields `unknown` (incomparable),
 *    never a defaulted band.
 *
 * Two documented asymmetries flow through here as `unknown`, not bugs (Phase 0): the Okta system
 * catch-all rule is returned LIVE but absent from tfstate, so a policy whose only rule is that
 * catch-all is `unknown` on the tfstate path yet banded live; and an unrecognized factorMode
 * (Identity-Engine variance) is `unknown`, never defaulted.
 */

import type { ParsedResource, RuleConstraint } from "../core/parse-tfstate.js";

/** One captured app-auth policy rule (the `ParsedResource` variant), from either capture path. */
type PolicyRule = Extract<ParsedResource, { kind: "AppAuthPolicyRule" }>;

/**
 * A policy's strength band — a conservative FLOOR. The four ORDERED bands run weakest→strongest;
 * `unknown` is INCOMPARABLE and is never ordered against a band (comparing to it yields
 * `incomparable`, never a direction).
 */
export type StrengthBand =
  | "single-factor" //          weakest ALLOW admits 1FA (weakest)
  | "two-factor" //             weakest ALLOW requires 2FA, no phishing-resistance guaranteed
  | "phishing-resistant-2fa" // weakest ALLOW requires phishing-resistant / hardware-protected 2FA
  | "deny-all" //               every ACTIVE rule denies — nobody gets in (strongest)
  | "unknown"; //               no readable ACTIVE rules, or an unclassifiable way in — never guessed

/** Ordinal for the four ORDERED bands (higher = stronger). `unknown` is absent — it is incomparable. */
const BAND_ORDINAL: Record<Exclude<StrengthBand, "unknown">, number> = {
  "single-factor": 1,
  "two-factor": 2,
  "phishing-resistant-2fa": 3,
  "deny-all": 4,
};

/** The per-ALLOW-rule classifications that participate in the floor (a strict subset of the bands). */
type KnownClass = "single-factor" | "two-factor" | "phishing-resistant-2fa";
type AllowClass = KnownClass | "unknown";

export type StrengthComparison = "weaker" | "stronger" | "same" | "incomparable";

/**
 * The rule that DECIDES a policy's band, plus the deciding rule's SCOPE. The floor is a policy
 * property, not proof every user reaches the app at that band; carrying `groupsIncluded` /
 * `networkConnection` lets Phase C caveat scope ("rule 'Contractors-Bypass', scoped to 1 group")
 * without ever evaluating the condition. `factorMode` is kept LITERAL (may be undefined on a DENY
 * rule, or a value like `2FA_If_Possible`) so the formatter phrases from evidence, never a guess.
 */
export interface StrengthEvidence {
  ruleId: string;
  ruleName: string;
  /** `ALLOW` | `DENY` — the deciding rule's access (a floor citation is ALLOW; deny-all cites a DENY). */
  access: string;
  /** Literal factorMode of the deciding rule, if any (undefined on DENY rules). */
  factorMode?: string;
  /** Group ids the deciding rule is scoped to; undefined = applies to everyone the policy covers. */
  groupsIncluded?: string[];
  /** Network scope of the deciding rule (e.g. `ANYWHERE` | `ZONE`); undefined = unset. */
  networkConnection?: string;
}

/** A policy's computed strength: the band, its ordinal (null when incomparable), and cited evidence. */
export interface PolicyStrength {
  policyId: string;
  band: StrengthBand;
  /** Band ordinal (1..4, higher = stronger); null when `band` is `unknown` (incomparable). */
  ordinal: number | null;
  /** The deciding rule + its scope, or null when `unknown` (nothing to cite without guessing). */
  evidence: StrengthEvidence | null;
  /** ACTIVE rules considered (INACTIVE excluded — the M12 rule). */
  activeRuleCount: number;
  /** Of the active rules, how many ALLOW (the floor is drawn from these). */
  allowRuleCount: number;
  /** Of the active rules, how many DENY (recorded; never raise the floor). */
  denyRuleCount: number;
}

/** INACTIVE rules are not evaluated by Okta and are excluded from the band (M12). Absent => ACTIVE. */
function isActive(r: PolicyRule): boolean {
  return r.status !== "INACTIVE";
}

/** True if any constraint REQUIRES a phishing-resistant OR hardware-protected possession factor. */
function requiresPhishingResistant(constraints: RuleConstraint[]): boolean {
  return constraints.some(
    (c) =>
      c.possession?.phishingResistant === "REQUIRED" || c.possession?.hardwareProtection === "REQUIRED",
  );
}

/**
 * Classify ONE ALLOW rule from its factorMode + constraints. Never guesses: an unrecognized/absent
 * factorMode is `unknown`. `2FA_If_Possible` (2FA-when-enrolled-else-1FA fallback, Phase 0 addendum)
 * is the conservative `single-factor` — the fallback is the easiest way in.
 */
function classifyAllow(rule: PolicyRule): AllowClass {
  switch (rule.factorMode) {
    case "1FA":
    case "2FA_If_Possible":
      return "single-factor";
    case "2FA":
      return requiresPhishingResistant(rule.constraints) ? "phishing-resistant-2fa" : "two-factor";
    default:
      return "unknown";
  }
}

/**
 * Deterministic citation order among equally-weak rules: Okta evaluates lowest-priority-number
 * first; an absent priority sorts LAST (the model.ts convention). id breaks any exact tie. This is
 * ONLY a tie-break for which rule to cite — it never selects the band (the band is the floor).
 */
function byPrecedence(a: PolicyRule, b: PolicyRule): number {
  const pa = a.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.id.localeCompare(b.id);
}

function evidenceOf(rule: PolicyRule): StrengthEvidence {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    access: rule.access,
    factorMode: rule.factorMode,
    groupsIncluded: rule.groupsIncluded,
    networkConnection: rule.networkConnection,
  };
}

interface RuleCounts {
  activeRuleCount: number;
  allowRuleCount: number;
  denyRuleCount: number;
}

function result(
  policyId: string,
  band: StrengthBand,
  evidence: StrengthEvidence | null,
  counts: RuleCounts,
): PolicyStrength {
  return {
    policyId,
    band,
    ordinal: band === "unknown" ? null : BAND_ORDINAL[band],
    evidence,
    ...counts,
  };
}

/**
 * Compute one policy's strength from ITS rules (the caller groups by policyId). `policyId` is passed
 * explicitly so an empty rule set still reports which policy is `unknown`.
 *
 * The floor algorithm, in order:
 *  1. No ACTIVE rules            -> `unknown`  (e.g. a tfstate policy whose only rule is the unmanaged catch-all).
 *  2. No ALLOW rule:
 *       every active rule a clean DENY -> `deny-all`  (nobody in; strongest). Cites the top-precedence DENY.
 *       an unrecognized `access` value -> `unknown`   (can't prove deny-all when a rule might admit someone).
 *  3. >=1 ALLOW rule            -> the WEAKEST classifiable ALLOW sets the floor; DENY never raises it.
 *       An unclassifiable ALLOW rule (`unknown` factorMode) could be a WEAKER way in, so it forces
 *       the whole policy to `unknown` UNLESS the known floor is already `single-factor` (the weakest
 *       band — nothing weaker for the unknown rule to hide). Never over-claim strength.
 */
export function computePolicyStrength(policyId: string, rules: PolicyRule[]): PolicyStrength {
  const active = rules.filter(isActive);
  const allow = active.filter((r) => r.access === "ALLOW");
  const deny = active.filter((r) => r.access === "DENY");
  const counts: RuleCounts = {
    activeRuleCount: active.length,
    allowRuleCount: allow.length,
    denyRuleCount: deny.length,
  };

  // (1) Nothing active to read.
  if (active.length === 0) return result(policyId, "unknown", null, counts);

  // (2) No way in among the active rules.
  if (allow.length === 0) {
    // Only claim deny-all when EVERY active rule is a clean DENY. An unrecognized access value
    // (neither ALLOW nor DENY) could admit someone — never over-claim strength.
    if (deny.length !== active.length) return result(policyId, "unknown", null, counts);
    const cite = [...deny].sort(byPrecedence)[0];
    return result(policyId, "deny-all", evidenceOf(cite), counts);
  }

  // (3) The floor is the weakest ALLOW.
  const classified = allow.map((rule) => ({ rule, cls: classifyAllow(rule) }));
  const known = classified.filter(
    (c): c is { rule: PolicyRule; cls: KnownClass } => c.cls !== "unknown",
  );
  const hasUnknownAllow = classified.some((c) => c.cls === "unknown");

  // Every ALLOW rule is unclassifiable — no floor without guessing.
  if (known.length === 0) return result(policyId, "unknown", null, counts);

  // Weakest known ALLOW by band ordinal, then precedence for a deterministic citation.
  const floor = [...known].sort(
    (a, b) => BAND_ORDINAL[a.cls] - BAND_ORDINAL[b.cls] || byPrecedence(a.rule, b.rule),
  )[0];

  // Honesty guard: an unclassifiable ALLOW rule might be weaker than the known floor. Only a
  // `single-factor` floor (the weakest band) is safe from being lowered further.
  if (hasUnknownAllow && floor.cls !== "single-factor") {
    return result(policyId, "unknown", null, counts);
  }

  return result(policyId, floor.cls, evidenceOf(floor.rule), counts);
}

/**
 * Group every `AppAuthPolicyRule` record by its policyId and compute each policy's strength. The
 * one entry point for Phase C surfaces: pass parsed resources (tfstate OR live), get a
 * policyId -> PolicyStrength map. A policy with NO captured rules is simply ABSENT from the map —
 * use `strengthForPolicy` to read "absent = unknown" in one place so surfaces can't diverge.
 */
export function policyStrengthIndex(resources: ParsedResource[]): Map<string, PolicyStrength> {
  const byPolicy = new Map<string, PolicyRule[]>();
  for (const r of resources) {
    if (r.kind !== "AppAuthPolicyRule") continue;
    const list = byPolicy.get(r.policyId);
    if (list) list.push(r);
    else byPolicy.set(r.policyId, [r]);
  }

  const out = new Map<string, PolicyStrength>();
  for (const [policyId, rules] of byPolicy) {
    out.set(policyId, computePolicyStrength(policyId, rules));
  }
  return out;
}

/**
 * Read a policy's strength from an index, defaulting to the canonical `unknown` result when the
 * policy has no captured rules (the tfstate-only-catch-all divergence, and any policy the snapshot
 * never read). The single place "absent = unknown, never a guess" is encoded.
 */
export function strengthForPolicy(
  index: Map<string, PolicyStrength>,
  policyId: string,
): PolicyStrength {
  return (
    index.get(policyId) ?? {
      policyId,
      band: "unknown",
      ordinal: null,
      evidence: null,
      activeRuleCount: 0,
      allowRuleCount: 0,
      denyRuleCount: 0,
    }
  );
}

/**
 * Compare band `a` AGAINST band `b`: is `a` weaker/stronger than / the same as `b`? `unknown` on
 * either side yields `incomparable` — the strength model never invents a direction it can't ground
 * (the M13/M14 honesty rule). Drives Phase C's grounded-verdict wording.
 */
export function compareBands(a: StrengthBand, b: StrengthBand): StrengthComparison {
  if (a === "unknown" || b === "unknown") return "incomparable";
  const oa = BAND_ORDINAL[a];
  const ob = BAND_ORDINAL[b];
  if (oa < ob) return "weaker";
  if (oa > ob) return "stronger";
  return "same";
}
