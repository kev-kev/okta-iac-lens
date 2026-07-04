/**
 * render/cli: turn trace/summary results into text or JSON for stdout.
 *
 * Presentation only — no traversal logic here.
 */

import type { GraphSummary, TraceResult } from "../core/access-paths.js";
import type { CoverageBucket, CoverageReport } from "../analysis/coverage.js";
import { recommend } from "../analysis/recommendations.js";

export type OutputFormat = "text" | "json";

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
