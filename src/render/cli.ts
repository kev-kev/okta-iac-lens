/**
 * render/cli: turn trace/summary results into text or JSON for stdout.
 *
 * Presentation only — no traversal logic here.
 */

import type {
  AppTraceResult,
  GraphSummary,
  TraceResult,
  UserAppExplain,
  UserAppPath,
  UserGroupAccess,
  UserTraceResult,
} from "../core/access-paths.js";
import type { CoverageBucket, CoverageReport } from "../analysis/coverage.js";
import type { RiskRow } from "../analysis/rank-risk.js";
import type { OutlierReport, OutlierRow } from "../analysis/policy-outliers.js";
import {
  formatPolicyFloor,
  ORG_DEFAULT_POLICY_LABEL,
  outlierStrengthVerdict,
  type StrengthResolver,
} from "../analysis/policy-strength.js";
import { recommend } from "../analysis/recommendations.js";

export type OutputFormat = "text" | "json";

/**
 * Trailing "  ·  floor: …" annotation for a policy line, from captured rules (M15 Phase C). Empty
 * when no resolver is supplied or the band is `unknown` (keep the bare label — never annotate a
 * band we didn't read). `policyId` is null for the org default, resolved via the resolver.
 */
function floorSuffix(policyId: string | null, strength?: StrengthResolver): string {
  if (!strength) return "";
  const floor = formatPolicyFloor(strength.forPolicyOrDefault(policyId));
  return floor ? `  ·  floor: ${floor}` : "";
}

/**
 * How a group populates a user: "populated by rule <name>: <expr>" (membership MAY be via that
 * rule — never evaluated) or "direct or app-push membership" when no rule populates it.
 */
function provenanceLabel(rules: UserGroupAccess["populatingRules"] | UserAppPath["populatingRules"]): string {
  if (rules.length === 0) return "direct or app-push membership";
  return "populated by rule " + rules.map((r) => `${r.name} (\`${r.expression}\`)`).join(", ");
}

function policyLabel(policy: { name: string; id: string } | null): string {
  return policy ? `${policy.name} (${policy.id})` : "— org default app sign-on policy";
}

/**
 * A null global session policy does NOT mean "no session gate" — it means the group falls back
 * to the org's DEFAULT session policy (which we don't model as a resource). Say so, rather than
 * "(none)", which reads as unprotected (M12 wording fix; mirrors `policyLabel`).
 */
function sessionPolicyLabel(policy: { name: string; id: string } | null): string {
  return policy ? `${policy.name} (${policy.id})` : "— org default session policy";
}

export function renderSummary(
  summary: GraphSummary,
  format: OutputFormat,
  /** okta_app_user count — surfaced as "present, not modeled" (M12). Omit when unavailable. */
  individualAssignments?: number,
): string {
  if (format === "json") {
    return JSON.stringify(
      individualAssignments === undefined ? summary : { ...summary, individualAssignments },
      null,
      2,
    );
  }
  const lines = [
    "IaC graph summary",
    `  Groups:                  ${summary.groups}`,
    `  Apps:                    ${summary.apps}`,
    `  Group rules:             ${summary.groupRules}`,
    `  Global session policies: ${summary.globalSessionPolicies}`,
    `  App auth policies:       ${summary.appAuthPolicies}`,
  ];
  if (individualAssignments !== undefined && individualAssignments > 0) {
    lines.push(
      `  Individual assignments:  ${individualAssignments}  (okta_app_user; present, not modeled as graph edges)`,
    );
  }
  return lines.join("\n");
}

export function renderTrace(
  result: TraceResult,
  format: OutputFormat,
  strength?: StrengthResolver,
): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(`Group: ${result.group.name} (${result.group.id})`);
  lines.push("");
  lines.push(`Apps granted (${result.apps.length}):`);
  if (result.apps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const app of result.apps) {
      const policy = result.appAuthPolicies[app.id];
      const label = policy ? `${policy.name} (${policy.id})` : "— org default app sign-on policy";
      lines.push(
        `  - ${app.name} (${app.id})  ·  app auth policy: ${label}${floorSuffix(policy ? policy.id : null, strength)}`,
      );
    }
  }
  lines.push("");
  const gsp = result.globalSessionPolicy;
  lines.push(`Global session policy: ${sessionPolicyLabel(gsp)}`);
  return lines.join("\n");
}

export function renderAppTrace(
  result: AppTraceResult,
  format: OutputFormat,
  strength?: StrengthResolver,
): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(`App: ${result.app.name} (${result.app.id})`);
  lines.push("");
  lines.push(`Reached by groups (${result.grantingGroups.length}):`);
  if (result.grantingGroups.length === 0) {
    lines.push("  (none)");
  } else {
    for (const g of result.grantingGroups) lines.push(`  - ${g.name} (${g.id})`);
  }
  lines.push("");
  const rules = result.populatingRules;
  lines.push(`Populated by rules (${rules.length}):`);
  for (const r of rules) lines.push(`  - ${r.name} (${r.id})`);
  lines.push("");
  const p = result.authPolicy;
  lines.push(
    `App auth policy: ${p ? `${p.name} (${p.id})` : "— org default app sign-on policy"}` +
      floorSuffix(p ? p.id : null, strength),
  );
  return lines.join("\n");
}

/** Honesty footnote appended to every user-facing access statement. */
const RUNTIME_CAVEAT =
  'Note: "provisioned to / gated by" reflects assignment; runtime policy conditions ' +
  "(MFA, device, network) are not evaluated here.";

/** Honesty footnote for any surface that scores/labels a gate by the org-default-vs-custom prior. */
const GATE_PRIOR_CAVEAT =
  "Note: gate strength is a heuristic prior (org-default vs custom policy), not a factor-based " +
  "verdict — M15. This flags a divergence, not a proven weakness.";

const INDIVIDUAL_VIA = "individual assignment (okta_app_user — not a group grant)";

export function renderUserTrace(
  result: UserTraceResult,
  format: OutputFormat,
  strength?: StrengthResolver,
): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const individualIds = new Set(result.individualApps.map((a) => a.id));

  const lines: string[] = [];
  lines.push(`User: ${result.user.login} (${result.user.id})`);
  lines.push("");

  lines.push(`Apps provisioned (${result.apps.length}):`);
  if (result.apps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const app of result.apps) {
      const via = individualIds.has(app.id)
        ? INDIVIDUAL_VIA
        : result.viaGroups
            .filter((v) => v.apps.some((a) => a.id === app.id))
            .map((v) => v.group.name)
            .join(", ");
      const gate = result.appAuthPolicies[app.id];
      lines.push(
        `  - ${app.name} (${app.id})  ·  via: ${via}  ·  app gate: ${policyLabel(gate)}${floorSuffix(gate ? gate.id : null, strength)}`,
      );
    }
    if (result.individualApps.length > 0) {
      lines.push(
        `  (+${result.individualApps.length} via individual assignment (okta_app_user) — not a group grant)`,
      );
    }
  }
  lines.push("");

  lines.push(`Group memberships (${result.viaGroups.length}):`);
  if (result.viaGroups.length === 0) {
    lines.push("  (none)");
  } else {
    for (const via of result.viaGroups) {
      const gsp = via.globalSessionPolicy;
      lines.push(
        `  - ${via.group.name} (${via.group.id})  ·  ${provenanceLabel(via.populatingRules)}` +
          `  ·  session gate: ${sessionPolicyLabel(gsp)}`,
      );
    }
  }
  if (result.unknownGroupIds.length > 0) {
    lines.push(
      `  (+ ${result.unknownGroupIds.length} membership group(s) outside the loaded Terraform/live scope, not shown)`,
    );
  }

  lines.push("");
  lines.push(RUNTIME_CAVEAT);
  return lines.join("\n");
}

export function renderUserAppExplain(
  result: UserAppExplain,
  format: OutputFormat,
  strength?: StrengthResolver,
): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(`User: ${result.user.login} (${result.user.id})`);
  lines.push(`App: ${result.app.name} (${result.app.id})`);
  lines.push("");

  const gateFloor = floorSuffix(result.authPolicy ? result.authPolicy.id : null, strength);
  if (result.hasAccess) {
    lines.push(`Result: PROVISIONED — reachable via ${result.paths.length} group(s).`);
    for (const p of result.paths) {
      const gsp = p.globalSessionPolicy;
      lines.push(
        `  - via ${p.group.name} (${p.group.id})  ·  ${provenanceLabel(p.populatingRules)}` +
          `  ·  session gate: ${sessionPolicyLabel(gsp)}`,
      );
    }
    lines.push(`App gate: ${policyLabel(result.authPolicy)}${gateFloor}`);
  } else {
    lines.push(
      `Result: NOT PROVISIONED — the user is in none of the ${result.grantingGroups.length} group(s) that grant this app.`,
    );
    lines.push("");
    lines.push(`Granted by groups (${result.grantingGroups.length}):`);
    if (result.grantingGroups.length === 0) {
      lines.push("  (none — no group grants this app)");
    } else {
      for (const g of result.grantingGroups) lines.push(`  - ${g.name} (${g.id})`);
    }
    lines.push("");
    lines.push(`Governing rules (${result.governingRules.length}) — expressions shown verbatim, NOT evaluated:`);
    if (result.governingRules.length === 0) {
      lines.push("  (none — the granting group(s) have no populating rule)");
    } else {
      for (const r of result.governingRules) lines.push(`  - ${r.name} (${r.id}): \`${r.expression}\``);
    }
    lines.push(`App gate (would apply): ${policyLabel(result.authPolicy)}${gateFloor}`);
  }

  lines.push("");
  lines.push(RUNTIME_CAVEAT);
  return lines.join("\n");
}

/** Compact band label for the risk table's `band` column. `unknown`/no-band renders as "—". */
const BAND_ABBREV: Record<string, string> = {
  "single-factor": "1FA",
  "two-factor": "2FA",
  "phishing-resistant-2fa": "PR-2FA",
  "deny-all": "DENY",
  unknown: "—",
};

export function renderRisk(
  rows: RiskRow[],
  format: OutputFormat,
  /** Rule-derived strength for the `band` column (M15). Display only here — the SCORE is computed in
   * `rankRisk`, which the caller passes the SAME resolver so the band column and score agree (M16). */
  strength?: StrengthResolver,
): string {
  if (format === "json") {
    // Structured band (M15 Phase D): attach each App row's captured gate band, so a JSON consumer
    // sees the same evidence the text `band` column shows AND the input the M16 score weighs on.
    // Group rows carry no band (session-gate strength is deferred, D2).
    if (!strength) return JSON.stringify(rows, null, 2);
    const enriched = rows.map((r) => {
      if (r.kind !== "App") return r;
      const s = strength.forPolicyOrDefault(r.gatePolicyId ?? null);
      return { ...r, band: s.band, bandOrdinal: s.ordinal };
    });
    return JSON.stringify(enriched, null, 2);
  }

  // App gate band from captured rules; Groups have no band (session gate is M15-deferred).
  const bandOf = (r: RiskRow): string =>
    strength && r.kind === "App"
      ? BAND_ABBREV[strength.forPolicyOrDefault(r.gatePolicyId ?? null).band] ?? "—"
      : "—";

  const lines: string[] = [];
  lines.push("Risk-ranked resources — widest reach × weakest gate × not-in-Terraform first");
  lines.push("");

  lines.push("  " + "#".padStart(3) + "  " + "resource".padEnd(24) + "kind".padEnd(7) + "reach".padStart(6) + "  " + "gate".padEnd(25) + "band".padEnd(8) + "iac".padEnd(11) + "score");
  rows.forEach((r, i) => {
    const iac = r.iac === "unknown" ? "n/a" : r.iac;
    const gate = `${r.gate} (${r.gatePrior})`;
    lines.push(
      "  " +
        `${i + 1}`.padStart(3) + "  " +
        r.name.slice(0, 23).padEnd(24) +
        r.kind.padEnd(7) +
        `${r.reach}`.padStart(6) + "  " +
        gate.padEnd(25) +
        bandOf(r).padEnd(8) +
        iac.padEnd(11) +
        `${r.score}`,
    );
  });
  lines.push("");
  if (strength) {
    // M16: the SCORE now weighs each App gate by its captured band (weaker ⇒ higher risk) — the band
    // column IS that scoring input, so the two can't disagree. Gates with no readable rules (band
    // 'unk') score neutral; GROUP session gates still weigh by the prior (rule strength uncaptured, D2).
    lines.push(
      "Note: App gate weight is the captured band (M15 rules) — weaker band ⇒ higher risk. Gates with",
    );
    lines.push(
      "no readable rules (band 'unk') score neutral; Group session gates still use the prior (D2).",
    );
  } else {
    lines.push(GATE_PRIOR_CAVEAT);
  }
  return lines.join("\n");
}

export function renderOutliers(
  report: OutlierReport,
  format: OutputFormat,
  /** Rule-derived strength (M15 Phase C). When supplied, findings whose BOTH bands are known carry
   * a grounded verdict; absent/unknown bands keep the M13 divergence prior. Omit = prior everywhere. */
  strength?: StrengthResolver,
): string {
  // Every finding's strength verdict, resolved ONCE through the shared helper so the text `↳`
  // lines, the `--json` block, and the web panel can never disagree (anti-drift). Empty when no
  // resolver was supplied — then every surface keeps the M13 prior.
  const verdictsOf = (r: OutlierRow) =>
    strength
      ? r.findings.map((f) =>
          outlierStrengthVerdict(
            strength,
            { policyId: r.appPolicyId, policyName: r.appPolicyName },
            { policyId: f.dominantPolicyId, policyName: f.dominantPolicyName },
          ),
        )
      : [];

  if (format === "json") {
    // Structured verdicts (M15 Phase D): the machine-readable twin of the `↳` lines. Attached only
    // when a resolver is supplied; each side's full `PolicyStrength` (band + cited rule) rides along.
    if (!strength) return JSON.stringify(report, null, 2);
    const rows = report.rows.map((r) => {
      const vs = verdictsOf(r);
      return {
        appId: r.appId,
        subject: strength.forPolicyOrDefault(r.appPolicyId),
        findings: r.findings.map((f, i) => ({
          groupId: f.groupId,
          dominantPolicyId: f.dominantPolicyId,
          baseline: vs[i]!.baseline,
          grounded: vs[i]!.verdict.grounded,
          ...(vs[i]!.verdict.grounded ? { direction: vs[i]!.verdict.direction } : {}),
        })),
      };
    });
    return JSON.stringify({ ...report, strength: { rows } }, null, 2);
  }

  const lines: string[] = [];
  lines.push("Policy outliers — apps diverging from their peer set's dominant auth policy");
  lines.push(
    `(peer set = apps granted to the same group; dominant = a unique policy covering >=2/3 of >=${report.minPeers} peers)`,
  );
  lines.push("");

  // Track whether ANY finding got a grounded verdict and whether ANY stayed a prior, so the
  // trailing caveat is honest about which regime is in play (Phase E stale-docs rule).
  let grounded = 0;
  let ungrounded = 0;

  if (report.rows.length === 0) {
    lines.push("  (no outliers)");
  } else {
    lines.push(
      "  " + "#".padStart(3) + "  " + "app".padEnd(24) + "policy".padEnd(16) +
        "severity".padEnd(28) + "groups".padStart(6) + "  score",
    );
    report.rows.forEach((r, i) => {
      lines.push(
        "  " +
          `${i + 1}`.padStart(3) + "  " +
          r.appName.slice(0, 23).padEnd(24) +
          (r.appPolicyName ?? "org default").slice(0, 15).padEnd(16) +
          r.severity.padEnd(28) +
          `${r.findingCount}`.padStart(6) + "  " +
          `${r.score}`,
      );
      // The subject (outlier app's own gate) is constant across findings; the baseline is each peer
      // set's dominant policy. The shared helper resolved both (org default via the resolver).
      const vs = verdictsOf(r);
      r.findings.forEach((f, i2) => {
        lines.push(
          `         - in ${f.groupName} (${f.peerCount} apps): ${f.dominantCount}/${f.peerCount} peers behind ${f.dominantPolicyName}`,
        );
        const line = vs[i2]?.line ?? null;
        if (line) {
          grounded++;
          lines.push(`           ↳ ${line}`);
        } else if (strength) {
          ungrounded++;
        }
      });
      if (r.findingCount > r.findings.length) {
        lines.push(`         …and ${r.findingCount - r.findings.length} more peer group(s)`);
      }
    });
  }

  lines.push("");
  lines.push(
    `Evaluated ${report.groupsEvaluated} peer group(s); ${report.groupsWithDominant} had a dominant policy.`,
  );
  lines.push(
    "Note: divergence compares WHICH policy applies, not policy contents — custom-vs-custom",
  );
  lines.push("mismatches may be intentional.");
  // Strength note adapts to what actually happened. The ↳ verdicts DO read the captured rules, so
  // the old blanket "rule strength is not evaluated" would now be a lie (Phase E) where any grounded.
  if (grounded > 0) {
    lines.push(
      "The ↳ lines DO read policy contents (M15): each side's weakest-way-in band, deciding rule",
    );
    lines.push("named. A scoped bypass floors the POLICY, not necessarily every app/user (see scope).");
    if (ungrounded > 0) {
      lines.push(
        "Findings with no ↳ have an unknown band (e.g. an org-default app on the tfstate path — its",
      );
      lines.push("rules aren't in state); those stay a divergence prior, not a proven weakness.");
    }
  } else if (strength && ungrounded > 0) {
    // Strength WAS read, but every shown divergence has an unknown band (e.g. an org-default app on
    // the tfstate path — the system policy's rules aren't in state). No grounded verdict is possible.
    lines.push(
      "No grounded verdict: every divergence shown has an unknown band (e.g. an org-default app on",
    );
    lines.push("the tfstate path — the system policy's rules aren't captured), so it stays a prior:");
    lines.push(GATE_PRIOR_CAVEAT);
  } else {
    // No strength supplied (or no findings) — the M13 prior stands verbatim.
    lines.push("Policy rule strength is not evaluated here.");
    lines.push(GATE_PRIOR_CAVEAT);
  }
  return lines.join("\n");
}

function formatPct(coverage: number | null): string {
  return coverage === null ? "n/a" : `${(coverage * 100).toFixed(1)}%`;
}

export function renderCoverage(report: CoverageReport, format: OutputFormat): string {
  const recommendations = recommend(report);
  if (format === "json") return JSON.stringify({ ...report, recommendations }, null, 2);

  const lines: string[] = [];
  lines.push("IaC coverage — live tenant vs Terraform state");
  lines.push("");

  const row = (a: string, b: string, c: string, d: string, e: string, f: string): string =>
    "  " + a.padEnd(22) + b.padStart(8) + c.padStart(6) + d.padStart(7) + e.padStart(6) + f.padStart(11);

  lines.push(row("kind", "managed", "gap", "stale", "excl", "coverage"));
  for (const k of report.perKind) {
    lines.push(
      row(k.kind, `${k.managed}`, `${k.unmanaged}`, `${k.stale}`, `${k.excluded}`, formatPct(k.coverage)),
    );
  }
  lines.push(`  ${"-".repeat(58)}`);
  const o = report.overall;
  lines.push(
    row("overall", `${o.managed}`, `${o.unmanaged}`, `${o.stale}`, `${o.excluded}`, formatPct(o.coverage)),
  );

  const section = (title: string, bucket: CoverageBucket, withReason: boolean): void => {
    const items = report.items.filter((i) => i.bucket === bucket);
    lines.push("");
    lines.push(`${title} (${items.length}):`);
    if (items.length === 0) {
      lines.push("  (none)");
      return;
    }
    for (const i of items) {
      const base = `  - [${i.kind}] ${i.name} (${i.key})`;
      lines.push(withReason && i.reason ? `${base} — ${i.reason}` : base);
    }
  };

  section("Unmanaged — in the tenant but not in Terraform", "unmanaged", false);
  section("Stale — in Terraform but not the tenant", "stale", false);
  section("Excluded — not Terraform-manageable", "excluded", true);

  // Plural-sourced provenance callout — only when such pairs exist (unlike the core buckets, an
  // empty "(none)" here would be noise for the common single-assignment tenant).
  const plural = report.items.filter((i) => i.viaPluralResource);
  if (plural.length > 0) {
    lines.push("");
    lines.push(`State-tracked via okta_app_group_assignments — absorbs click-ops drift (${plural.length}):`);
    lines.push(
      "  Caveat: the plural resource re-reads ALL assigned groups on refresh, so a click-ops",
    );
    lines.push(
      "  assignment gets absorbed into state and reported as managed — coverage cannot detect it.",
    );
    for (const i of plural) {
      lines.push(`  - [${i.kind}] ${i.name} (${i.key}) — ${i.bucket}`);
    }
  }

  lines.push("");
  lines.push("Recommended steps:");
  for (const r of recommendations) {
    lines.push(`  • ${r.title}`);
    lines.push(`      ${r.detail}`);
  }

  return lines.join("\n");
}
