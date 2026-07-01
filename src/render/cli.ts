/**
 * render/cli: turn trace/summary results into text or JSON for stdout.
 *
 * Presentation only — no traversal logic here.
 */

import type { GraphSummary, TraceResult } from "../core/access-paths.js";

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
