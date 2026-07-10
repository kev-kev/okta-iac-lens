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
import type { OutlierReport } from "../analysis/policy-outliers.js";
import { recommend } from "../analysis/recommendations.js";

export type OutputFormat = "text" | "json";

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

export function renderSummary(summary: GraphSummary, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(summary, null, 2);
  return [
    "IaC graph summary",
    `  Groups:                  ${summary.groups}`,
    `  Apps:                    ${summary.apps}`,
    `  Group rules:             ${summary.groupRules}`,
    `  Global session policies: ${summary.globalSessionPolicies}`,
    `  App auth policies:       ${summary.appAuthPolicies}`,
  ].join("\n");
}

export function renderTrace(result: TraceResult, format: OutputFormat): string {
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
      const policyLabel = policy
        ? `${policy.name} (${policy.id})`
        : "— org default app sign-on policy";
      lines.push(`  - ${app.name} (${app.id})  ·  app auth policy: ${policyLabel}`);
    }
  }
  lines.push("");
  const gsp = result.globalSessionPolicy;
  lines.push(`Global session policy: ${gsp ? `${gsp.name} (${gsp.id})` : "(none)"}`);
  return lines.join("\n");
}

export function renderAppTrace(result: AppTraceResult, format: OutputFormat): string {
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
  lines.push(`App auth policy: ${p ? `${p.name} (${p.id})` : "— org default app sign-on policy"}`);
  return lines.join("\n");
}

/** Honesty footnote appended to every user-facing access statement. */
const RUNTIME_CAVEAT =
  'Note: "provisioned to / gated by" reflects assignment; runtime policy conditions ' +
  "(MFA, device, network) are not evaluated here.";

export function renderUserTrace(result: UserTraceResult, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(`User: ${result.user.login} (${result.user.id})`);
  lines.push("");

  lines.push(`Apps provisioned (${result.apps.length}):`);
  if (result.apps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const app of result.apps) {
      const via = result.viaGroups
        .filter((v) => v.apps.some((a) => a.id === app.id))
        .map((v) => v.group.name)
        .join(", ");
      lines.push(
        `  - ${app.name} (${app.id})  ·  via: ${via}  ·  app gate: ${policyLabel(result.appAuthPolicies[app.id])}`,
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
          `  ·  session gate: ${gsp ? `${gsp.name} (${gsp.id})` : "(none)"}`,
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

export function renderUserAppExplain(result: UserAppExplain, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(`User: ${result.user.login} (${result.user.id})`);
  lines.push(`App: ${result.app.name} (${result.app.id})`);
  lines.push("");

  if (result.hasAccess) {
    lines.push(`Result: PROVISIONED — reachable via ${result.paths.length} group(s).`);
    for (const p of result.paths) {
      const gsp = p.globalSessionPolicy;
      lines.push(
        `  - via ${p.group.name} (${p.group.id})  ·  ${provenanceLabel(p.populatingRules)}` +
          `  ·  session gate: ${gsp ? `${gsp.name} (${gsp.id})` : "(none)"}`,
      );
    }
    lines.push(`App gate: ${policyLabel(result.authPolicy)}`);
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
    lines.push(`App gate (would apply): ${policyLabel(result.authPolicy)}`);
  }

  lines.push("");
  lines.push(RUNTIME_CAVEAT);
  return lines.join("\n");
}

export function renderRisk(rows: RiskRow[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(rows, null, 2);

  const lines: string[] = [];
  lines.push("Risk-ranked resources — widest reach × weakest gate × not-in-Terraform first");
  lines.push("");

  lines.push("  " + "#".padStart(3) + "  " + "resource".padEnd(24) + "kind".padEnd(7) + "reach".padStart(6) + "  " + "gate".padEnd(25) + "iac".padEnd(11) + "score");
  rows.forEach((r, i) => {
    const iac = r.iac === "unknown" ? "n/a" : r.iac;
    const gate = `${r.gate} (${r.gateStrength})`;
    lines.push(
      "  " +
        `${i + 1}`.padStart(3) + "  " +
        r.name.slice(0, 23).padEnd(24) +
        r.kind.padEnd(7) +
        `${r.reach}`.padStart(6) + "  " +
        gate.padEnd(25) +
        iac.padEnd(11) +
        `${r.score}`,
    );
  });
  return lines.join("\n");
}

export function renderOutliers(report: OutlierReport, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  const lines: string[] = [];
  lines.push("Policy outliers — apps diverging from their peer set's dominant auth policy");
  lines.push(
    `(peer set = apps granted to the same group; dominant = a unique policy covering >=2/3 of >=${report.minPeers} peers)`,
  );
  lines.push("");

  if (report.rows.length === 0) {
    lines.push("  (no outliers)");
  } else {
    lines.push(
      "  " + "#".padStart(3) + "  " + "app".padEnd(24) + "policy".padEnd(16) +
        "severity".padEnd(20) + "groups".padStart(6) + "  score",
    );
    report.rows.forEach((r, i) => {
      lines.push(
        "  " +
          `${i + 1}`.padStart(3) + "  " +
          r.appName.slice(0, 23).padEnd(24) +
          (r.appPolicyName ?? "org default").slice(0, 15).padEnd(16) +
          r.severity.padEnd(20) +
          `${r.findingCount}`.padStart(6) + "  " +
          `${r.score}`,
      );
      for (const f of r.findings) {
        lines.push(
          `         - in ${f.groupName} (${f.peerCount} apps): ${f.dominantCount}/${f.peerCount} peers behind ${f.dominantPolicyName}`,
        );
      }
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
  lines.push("mismatches may be intentional. Policy rule strength is not evaluated.");
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

  lines.push("");
  lines.push("Recommended steps:");
  for (const r of recommendations) {
    lines.push(`  • ${r.title}`);
    lines.push(`      ${r.detail}`);
  }

  return lines.join("\n");
}
