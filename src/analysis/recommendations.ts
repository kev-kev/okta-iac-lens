/**
 * analysis/recommendations: derive "what should I do to raise my IaC coverage?" from a
 * CoverageReport. PURE. No I/O — imported by BOTH the CLI renderer and the web viewer, so the
 * guidance is one source of truth and can never drift between surfaces (it's never serialized;
 * both sides call this on the same report).
 *
 * Guidance only — this never mutates Okta and never writes config. The human runs `terraform`.
 */

import type { ResourceKind, SlimCoverageReport } from "./coverage.js";

export type RecommendationSeverity = "action" | "info" | "success";

export interface Recommendation {
  severity: RecommendationSeverity;
  title: string;
  detail: string;
}

const KIND_NOUN: Record<ResourceKind, string> = {
  Group: "group",
  App: "app",
  AppGroupAssignment: "app-group assignment",
  GroupRule: "group rule",
  GlobalSessionPolicy: "global session policy",
  AppAuthPolicy: "app auth policy",
  // Kept out of coverage's KIND_ORDER (never coverage items); present for Record completeness.
  AppUserAssignment: "individual app assignment",
  AppAccessPolicyAssignment: "app access-policy assignment",
  AppAuthPolicyRule: "app auth policy rule",
};

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Priority-ordered guidance. Actions first (unmanaged, then stale), then info, then success. */
export function recommend(report: SlimCoverageReport): Recommendation[] {
  const recs: Recommendation[] = [];
  const { managed, unmanaged, stale, excluded } = report.overall;

  if (unmanaged > 0) {
    const breakdown = report.perKind
      .filter((k) => k.unmanaged > 0)
      .map((k) => plural(k.unmanaged, KIND_NOUN[k.kind]))
      .join(", ");
    recs.push({
      severity: "action",
      title: `Bring ${plural(unmanaged, "resource")} under IaC`,
      detail:
        `${breakdown} exist in Okta but not in Terraform. Generate import blocks with ` +
        "`coverage --imports <file>`, add them to your config, then `terraform plan` to import.",
    });
  }

  if (stale > 0) {
    recs.push({
      severity: "action",
      title: `Resolve ${plural(stale, "stale resource")}`,
      detail:
        `${plural(stale, "resource")} in Terraform no longer exist in the tenant. Remove them ` +
        "from config, or investigate whether the state is stale or from a different tenant.",
    });
  }

  if (excluded > 0) {
    recs.push({
      severity: "info",
      title: `${plural(excluded, "resource")} not Terraform-manageable (not a gap)`,
      detail:
        `${plural(excluded, "resource")} aren't Terraform-manageable — each carries its specific ` +
        "reason (see the excluded list). They're excluded from the coverage %, not counted against you.",
    });
  }

  const pluralCount = report.items.filter((i) => i.viaPluralResource).length;
  if (pluralCount > 0) {
    recs.push({
      severity: "info",
      title: `${plural(pluralCount, "assignment")} state-tracked via okta_app_group_assignments`,
      detail:
        "The plural resource re-reads ALL groups assigned to the app on refresh, so a click-ops " +
        "assignment is absorbed into state and reported as managed — presence-only coverage can't " +
        "detect that drift. Treat these pairs' `managed` status as absorbs-drift, not verified.",
    });
  }

  if (unmanaged === 0 && stale === 0) {
    recs.push({
      severity: "success",
      title: managed > 0 ? `All ${plural(managed, "managed resource")} under IaC` : "Nothing to manage",
      detail:
        managed > 0
          ? "Every Terraform-manageable resource in the tenant is under IaC. Coverage is 100%."
          : "No Terraform-manageable resources were found in the tenant.",
    });
  }

  return recs;
}
