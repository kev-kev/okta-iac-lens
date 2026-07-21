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

import type { AppAuthPolicyRule, ParsedResource, RuleConstraint } from "../core/parse-tfstate.js";

/** One captured app-auth policy rule (the `ParsedResource` variant), from either capture path. */
type PolicyRule = AppAuthPolicyRule;

/**
 * The captured app-auth policy rules from a resource set — the exact subset the envelope carries
 * (M15 Phase D) and the strength model consumes. One place so producers can't diverge on which
 * records count as "rules".
 */
export function appAuthPolicyRules(resources: ParsedResource[]): AppAuthPolicyRule[] {
  return resources.filter((r): r is AppAuthPolicyRule => r.kind === "AppAuthPolicyRule");
}

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

/** The canonical `unknown` strength for a policy with no captured/readable rules — the single shape
 * "absent = unknown, never a guess" resolves to (Phase 0 divergence; any policy the snapshot missed). */
function unknownStrength(policyId: string): PolicyStrength {
  return {
    policyId,
    band: "unknown",
    ordinal: null,
    evidence: null,
    activeRuleCount: 0,
    allowRuleCount: 0,
    denyRuleCount: 0,
  };
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
  return index.get(policyId) ?? unknownStrength(policyId);
}

/**
 * The id of the org-default (system) app-auth policy, or null when the snapshot carries none of its
 * rules. Identified by the `policySystem` flag `map-api` stamps on that policy's rules — the
 * org-default is NEVER a graph node, so this is the only channel a null-policy app has to its band.
 * ALWAYS null on the tfstate path (state has no system policy — the documented Phase 0 divergence),
 * so a null-policy app stays `unknown` there; live, it resolves to the system policy's band.
 */
export function orgDefaultPolicyId(resources: ParsedResource[]): string | null {
  for (const r of resources) {
    if (r.kind === "AppAuthPolicyRule" && r.policySystem) return r.policyId;
  }
  return null;
}

/**
 * A resolver bound to one snapshot's rules: band ANY policy id, and — crucially — band the graph's
 * "org default" (a null policy key, i.e. an app with no custom `protects` edge) by mapping it onto
 * the system policy's band. Phase C's surfaces (outliers/risk/trace) all read strength through this
 * ONE object so "null = org default" is resolved in a single place and they cannot diverge.
 */
export interface StrengthResolver {
  /** Strength of a specific policy id (a custom `protects` edge / `authenticationPolicyId`). */
  forPolicy(policyId: string): PolicyStrength;
  /** The band an app with NO custom policy falls back to — the org default (`unknown` on tfstate). */
  orgDefault(): PolicyStrength;
  /** Band a nullable policy key the graph surfaces carry: `null` = org default, else `forPolicy`. */
  forPolicyOrDefault(policyId: string | null): PolicyStrength;
}

export function strengthResolver(resources: ParsedResource[]): StrengthResolver {
  const index = policyStrengthIndex(resources);
  const orgId = orgDefaultPolicyId(resources);
  const orgDefault = orgId ? strengthForPolicy(index, orgId) : unknownStrength("__org_default__");
  return {
    forPolicy: (id) => strengthForPolicy(index, id),
    orgDefault: () => orgDefault,
    forPolicyOrDefault: (id) => (id === null ? orgDefault : strengthForPolicy(index, id)),
  };
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

// ── Grounded verdicts (Phase C) — the ONE shared formatter every surface renders through ──────────

/**
 * A grounded strength verdict: BOTH policies had captured, classifiable (non-`unknown`) bands, so a
 * surface can state a direction backed by rule evidence instead of the M13 prior.
 */
export interface GroundedStrengthVerdict {
  grounded: true;
  /** `subject` compared AGAINST `baseline`. Never `incomparable` here — both bands are known. */
  direction: "weaker" | "stronger" | "same";
  subject: PolicyStrength;
  baseline: PolicyStrength;
}
/**
 * At least one side is `unknown`: no grounded direction exists, so the caller MUST keep its M13
 * prior wording verbatim (the honesty rule — never invent a direction we cannot ground).
 */
export interface UngroundedStrengthVerdict {
  grounded: false;
}
export type StrengthVerdict = GroundedStrengthVerdict | UngroundedStrengthVerdict;

/**
 * Compare a subject policy AGAINST a baseline. Grounded only when both bands are known; otherwise
 * ungrounded (`grounded: false`) and the surface falls back to its prior. This is the single gate
 * between "we read the rules" and "we're still on the M13 prior".
 */
export function strengthVerdict(subject: PolicyStrength, baseline: PolicyStrength): StrengthVerdict {
  const direction = compareBands(subject.band, baseline.band);
  if (direction === "incomparable") return { grounded: false };
  return { grounded: true, direction, subject, baseline };
}

/**
 * Human requirement phrase for a band — the easiest documented way in (the floor). `unknown` has no
 * honest phrase, so it returns a plain "no readable rules"; the formatter never reaches it for a
 * grounded verdict (both sides are known there).
 */
export function describeBand(band: StrengthBand): string {
  switch (band) {
    case "single-factor":
      return "admits single-factor (1FA)";
    case "two-factor":
      return "requires two-factor (2FA)";
    case "phishing-resistant-2fa":
      return "requires phishing-resistant 2FA";
    case "deny-all":
      return "denies all access";
    case "unknown":
      return "has no readable rules";
  }
}

/**
 * Cite the deciding rule + its SCOPE, so the floor stays honest: a group/network-scoped bypass is
 * a policy property, not proof every user reaches the app at that band (Phase 0). `ANYWHERE` is the
 * unrestricted default and is omitted; a real network restriction is surfaced.
 */
function citeRule(s: PolicyStrength): string {
  const e = s.evidence;
  if (!e) return "";
  const scope: string[] = [];
  const groups = e.groupsIncluded?.length ?? 0;
  if (groups > 0) scope.push(`scoped to ${groups} group${groups === 1 ? "" : "s"}`);
  if (e.networkConnection && e.networkConnection !== "ANYWHERE") {
    scope.push(`network ${e.networkConnection}`);
  }
  return ` [rule '${e.ruleName}'${scope.length > 0 ? `, ${scope.join(", ")}` : ""}]`;
}

/**
 * Render a grounded verdict as one line, e.g.
 *   "stronger: org default requires two-factor (2FA) [rule 'Catch-all'], baseline Strict-Auth
 *    admits single-factor (1FA) [rule 'Contractors-Bypass', scoped to 1 group]".
 * Labels are supplied by the caller (the graph names the policies; the org default has no node).
 * ONE formatter for CLI and web so a verdict never drifts between surfaces.
 */
export function formatStrengthVerdict(
  verdict: GroundedStrengthVerdict,
  subjectLabel: string,
  baselineLabel: string,
): string {
  const { direction, subject, baseline } = verdict;
  return (
    `${direction}: ${subjectLabel} ${describeBand(subject.band)}${citeRule(subject)}, ` +
    `baseline ${baselineLabel} ${describeBand(baseline.band)}${citeRule(baseline)}`
  );
}

/**
 * One-line floor evidence for a SINGLE policy (no comparison): the band phrase + deciding rule with
 * scope, e.g. "admits single-factor (1FA) [rule 'Contractors-Bypass', scoped to 1 group]". Returns
 * null when the band is `unknown` — the caller then keeps the bare policy label (the M13 honesty
 * rule: never annotate a band we did not read). Used by trace/risk to surface a gate's captured floor.
 */
export function formatPolicyFloor(s: PolicyStrength): string | null {
  if (s.band === "unknown") return null;
  return `${describeBand(s.band)}${citeRule(s)}`;
}

/**
 * The canonical label for the org-default app sign-on policy (which has no graph node, hence no
 * name of its own). ONE string so the CLI, the web panels, and the JSON never drift on how a
 * null-policy gate is named in a verdict.
 */
export const ORG_DEFAULT_POLICY_LABEL = "org default app sign-on policy";

/**
 * One policy-outlier finding resolved to a strength verdict — the SINGLE shared unit every outlier
 * surface (CLI text, web panel/table, `--json`) renders through, so they cannot diverge on the
 * grounded/prior decision, the org-default resolution, or the verdict wording. Given the outlier
 * app's own gate (`subject`, whose id is `null` for the org default) and its peer set's dominant
 * policy (`baseline`, always a custom id), it returns:
 *  - `subject`/`baseline` — both sides' `PolicyStrength` (for structured/JSON consumers),
 *  - `verdict` — grounded only when BOTH bands are known,
 *  - `line` — the formatted grounded verdict, or `null` when ungrounded (the caller then keeps its
 *    M13 prior VERBATIM — the honesty rule).
 */
export interface OutlierStrengthVerdict {
  subject: PolicyStrength;
  baseline: PolicyStrength;
  verdict: StrengthVerdict;
  line: string | null;
}

export function outlierStrengthVerdict(
  resolver: StrengthResolver,
  outlier: { policyId: string | null; policyName: string | null },
  dominant: { policyId: string; policyName: string },
): OutlierStrengthVerdict {
  const subject = resolver.forPolicyOrDefault(outlier.policyId);
  const baseline = resolver.forPolicy(dominant.policyId);
  const verdict = strengthVerdict(subject, baseline);
  const line = verdict.grounded
    ? formatStrengthVerdict(verdict, outlier.policyName ?? ORG_DEFAULT_POLICY_LABEL, dominant.policyName)
    : null;
  return { subject, baseline, verdict, line };
}
