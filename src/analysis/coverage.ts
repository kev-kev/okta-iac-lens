/**
 * analysis/coverage: reconcile a live Okta tenant against Terraform state.
 *
 * PURE. Input is two normalized `ParsedResource[]` arrays (live + state) from the SAME
 * tenant; output is a per-kind + overall IaC-coverage report. No I/O, no network — the
 * architecture principle (src/core purity) extends to src/analysis.
 *
 * Presence-only (M3): resources are compared by IDENTITY, never by attribute values
 * (attribute drift is deferred). Classification ORDER is load-bearing (see PLAN.md):
 * state presence decides `managed`/`stale` FIRST; exclusion only ever partitions the
 * live-only set. That ordering is enforced structurally here — `exclusionReason` is
 * called ONLY inside the live-only branch — so a Terraform-managed-but-unattached policy
 * (present in both live and state) is always `managed`, never a false `stale`/`excluded`.
 */

import type { ParsedResource } from "../core/parse-tfstate.js";
import { isBuiltInAppPolicyName } from "./okta-builtins.js";

type AppResource = Extract<ParsedResource, { kind: "App" }>;

export type ResourceKind = ParsedResource["kind"];

/**
 * - `managed`   — in live AND state (counts toward coverage)
 * - `unmanaged` — live only, and Terraform-manageable: the IaC gap (import-block candidate)
 * - `stale`     — state only: deleted out-of-band, or a stale/foreign state file (report only)
 * - `excluded`  — live only, but not Terraform-manageable / Okta-managed noise (out of the denominator)
 */
export type CoverageBucket = "managed" | "unmanaged" | "stale" | "excluded";

/** Everything about a classified resource EXCEPT the embedded record — the fields the viewer,
 * badges, and `recommend()` read. The slim envelope carries these. */
export interface CoverageItemBase {
  kind: ResourceKind;
  /** Within-kind identity: `id` for most kinds, `${appId}/${groupId}` for assignments. */
  key: string;
  /** Human-facing label ("<app> / <group>" for assignments). */
  name: string;
  bucket: CoverageBucket;
  /** Why a live-only record was excluded. Set iff `bucket === "excluded"`. */
  reason?: string;
  /**
   * AppGroupAssignment provenance: set (only) when the STATE-side record came from the plural
   * `okta_app_group_assignments` resource, which re-reads ALL assigned groups on refresh and so
   * absorbs click-ops drift into state (the CLAUDE.md gotcha). Present on `managed`/`stale` items
   * only — `unmanaged`/`excluded` are live-only and can never carry it. Surfaces drive the
   * "absorbs click-ops drift" caveat off this flag.
   */
  viaPluralResource?: true;
}

export interface CoverageItem extends CoverageItemBase {
  /** Underlying record: the live record for managed/unmanaged/excluded, the state record for stale.
   * Used only by import-block generation (CLI); the viewer never needs it (see `slimCoverage`). */
  resource: ParsedResource;
}

export interface KindCoverage {
  kind: ResourceKind;
  managed: number;
  unmanaged: number;
  stale: number;
  excluded: number;
  /** managed / (managed + unmanaged); null when that denominator is 0. */
  coverage: number | null;
}

export interface CoverageReport {
  /** Per-kind rows, in a stable kind order; kinds with zero resources on both sides are omitted. */
  perKind: KindCoverage[];
  /** Totals across all kinds. */
  overall: Omit<KindCoverage, "kind">;
  /** Every classified resource, sorted by (kind, bucket, key) for deterministic output. */
  items: CoverageItem[];
}

/** The report minus per-item `resource` — the shape embedded in the viewer envelope. A full
 * `CoverageReport` is structurally assignable to this, so functions typed to it accept both. */
export interface SlimCoverageReport {
  perKind: KindCoverage[];
  overall: Omit<KindCoverage, "kind">;
  items: CoverageItemBase[];
}

/** Drop per-item `resource` for the viewer envelope — the viewer never reads it, and it's the
 * bulk of the report (~2.6× the graph). PURE. */
export function slimCoverage(report: CoverageReport): SlimCoverageReport {
  return {
    perKind: report.perKind,
    overall: report.overall,
    items: report.items.map(({ resource: _resource, ...base }) => base),
  };
}

/**
 * Stable display/sort order for kinds — and the WHITELIST of kinds coverage classifies.
 * `AppUserAssignment` and `AppAccessPolicyAssignment` are deliberately absent: the read-only
 * live snapshot structurally cannot contain them (we don't fetch per-app users, and live
 * app-auth arrives via the app's inline policy link, not a standalone assignment), so bucketing
 * them live-vs-state would falsely report every one as `stale`. Individual assignments are
 * COUNTED separately (`countIndividualAssignments`) and surfaced as a summary notice instead.
 */
const KIND_ORDER: ResourceKind[] = [
  "Group",
  "App",
  "AppGroupAssignment",
  "GroupRule",
  "GlobalSessionPolicy",
  "AppAuthPolicy",
];

/**
 * Count individual (`okta_app_user`) user→app assignments in a resource set — the unmodeled
 * access channel (M11 review). Surfaced as "N present, not modeled" so it is never silently
 * dropped; the per-user trace inclusion is M13's per-app `scope: USER` check. PURE.
 */
export function countIndividualAssignments(resources: ParsedResource[]): number {
  return resources.filter((r) => r.kind === "AppUserAssignment").length;
}

/** Stable display/sort order for buckets — gaps first, managed last. */
const BUCKET_ORDER: CoverageBucket[] = ["unmanaged", "stale", "excluded", "managed"];

/** Within-kind identity key. Assignment kinds carry no `id`; use the paired ids. */
function keyOf(r: ParsedResource): string {
  switch (r.kind) {
    case "AppGroupAssignment":
      return `${r.appId}/${r.groupId}`;
    case "AppUserAssignment":
      return `${r.appId}/${r.userId}`;
    case "AppAccessPolicyAssignment":
      return `${r.appId}/${r.policyId}`;
    default:
      return r.id;
  }
}

/** id -> display name for Groups and Apps, so assignment items can read "<app> / <group>". Live wins. */
function buildNameMap(live: ParsedResource[], state: ParsedResource[]): Map<string, string> {
  const names = new Map<string, string>();
  // State first, then live overwrites — so live names take precedence.
  for (const r of [...state, ...live]) {
    if (r.kind === "Group" || r.kind === "App") names.set(r.id, r.name);
  }
  return names;
}

function nameOf(r: ParsedResource, names: Map<string, string>): string {
  switch (r.kind) {
    case "AppGroupAssignment":
      return `${names.get(r.appId) ?? r.appId} / ${names.get(r.groupId) ?? r.groupId}`;
    case "AppUserAssignment":
      // Kept out of KIND_ORDER (never a coverage item) — the live snapshot can't contain
      // individual assignments, so classifying them here would be a false `stale`. Total for the
      // compiler only. The count is surfaced via `individualAssignmentCount` + the summary notice.
      return `${names.get(r.appId) ?? r.appId} / user ${r.userId}`;
    case "AppAccessPolicyAssignment":
      return `${names.get(r.appId) ?? r.appId} / policy ${r.policyId}`;
    default:
      return r.name;
  }
}

interface LiveContext {
  /**
   * Non-null `authenticationPolicyId` of every live App that is Terraform-MANAGEABLE (in state,
   * or live-only with no exclusion reason). A live-only AppAuthPolicy referenced only by
   * non-manageable apps (e.g. an excluded built-in console app, were one ever present) is NOT a
   * real IaC gap. Re-keyed from the old "referenced by ANY live app" (M14: the mis-keyed predicate).
   */
  manageableReferencedAuthPolicyIds: Set<string>;
}

function buildLiveContext(live: ParsedResource[], stateAppKeys: Set<string>): LiveContext {
  const manageableReferencedAuthPolicyIds = new Set<string>();
  for (const r of live) {
    if (r.kind !== "App" || !r.authenticationPolicyId) continue;
    // Terraform-manageable app = present in state, or live-only and not excluded. On the primary
    // path App has no exclusion predicate (appExclusionReason → null), so every app qualifies; the
    // guard is correct-by-construction if the built-in-app contingency ever excludes some.
    if (stateAppKeys.has(r.id) || appExclusionReason(r) === null) {
      manageableReferencedAuthPolicyIds.add(r.authenticationPolicyId);
    }
  }
  return { manageableReferencedAuthPolicyIds };
}

/**
 * Whether a live-only App is Okta-managed rather than Terraform-manageable, or null (a real gap).
 * PRIMARY PATH: always null — the fresh capture shows `/api/v1/apps` returns no built-in apps, so
 * no catalog identity can be proven to never be a real app. CONTINGENCY (PLAN.md): if a future
 * capture surfaces built-in apps, add a `BUILT_IN_APP_CATALOG_NAMES.has(r.catalogName)` check here
 * plus its own fixture-verification assertion. Kept as a named seam so `buildLiveContext` and
 * `exclusionReason` share one definition of "manageable app".
 */
function appExclusionReason(_app: AppResource): string | null {
  return null;
}

/**
 * Reason a LIVE-ONLY record is not manageable Terraform config, or null if it's a real IaC
 * gap. Only ever called on records absent from state — a resource present in state is
 * `managed` and never reaches here (this is what keeps the ordering correct).
 */
function exclusionReason(r: ParsedResource, ctx: LiveContext): string | null {
  switch (r.kind) {
    case "Group":
      // Only OKTA_GROUP is manageable via okta_group; BUILT_IN / APP_GROUP are not. A
      // missing groupType is treated as manageable (surface it as a gap, don't hide it).
      return r.groupType != null && r.groupType !== "OKTA_GROUP"
        ? `Okta ${r.groupType} group; not manageable via okta_group`
        : null;
    case "App":
      return appExclusionReason(r);
    case "GlobalSessionPolicy":
      return r.system === true
        ? "Okta system global session policy (org default); not managed config"
        : null;
    case "AppAuthPolicy":
      // Non-system, APP-typed policies reach here (the mapper already dropped the rest). Referenced
      // by a Terraform-manageable app => a real gap (unmanaged). Otherwise excluded — the reason is
      // IDENTITY-refined only (built-in console name) but the bucket is decided by references alone,
      // so a custom policy spoof-named "Okta Dashboard" that a real app references still lands here
      // as null (unmanaged), never a false built-in claim.
      if (ctx.manageableReferencedAuthPolicyIds.has(r.id)) return null;
      return isBuiltInAppPolicyName(r.name)
        ? "access policy of Okta built-in console app — not Terraform-manageable"
        : "app access policy referenced by no Terraform-manageable app in the live snapshot";
    default:
      return null; // GroupRule, AppGroupAssignment: no exclusion predicate.
  }
}

/** Index resources by kind, then by within-kind key (later duplicates overwrite earlier). */
function indexByKind(resources: ParsedResource[]): Map<ResourceKind, Map<string, ParsedResource>> {
  const byKind = new Map<ResourceKind, Map<string, ParsedResource>>();
  for (const r of resources) {
    let m = byKind.get(r.kind);
    if (!m) {
      m = new Map();
      byKind.set(r.kind, m);
    }
    m.set(keyOf(r), r);
  }
  return byKind;
}

function makeItem(
  resource: ParsedResource,
  bucket: CoverageBucket,
  names: Map<string, string>,
  reason?: string,
  /**
   * State-side record for provenance. For `managed`, `resource` is the LIVE record (which lacks
   * the flag — the live path has no plural resource), so the `viaPluralResource` flag must be read
   * from here. For `stale` it's the same object as `resource`. Undefined for live-only buckets.
   */
  stateR?: ParsedResource,
): CoverageItem {
  const item: CoverageItem = {
    kind: resource.kind,
    key: keyOf(resource),
    name: nameOf(resource, names),
    bucket,
    resource,
  };
  if (reason) item.reason = reason;
  if (stateR?.kind === "AppGroupAssignment" && stateR.viaPluralResource) {
    item.viaPluralResource = true;
  }
  return item;
}

function coverageRatio(managed: number, unmanaged: number): number | null {
  const denom = managed + unmanaged;
  return denom === 0 ? null : managed / denom;
}

function countBuckets(items: CoverageItem[]): Omit<KindCoverage, "kind"> {
  let managed = 0;
  let unmanaged = 0;
  let stale = 0;
  let excluded = 0;
  for (const i of items) {
    if (i.bucket === "managed") managed++;
    else if (i.bucket === "unmanaged") unmanaged++;
    else if (i.bucket === "stale") stale++;
    else excluded++;
  }
  return { managed, unmanaged, stale, excluded, coverage: coverageRatio(managed, unmanaged) };
}

/**
 * Classify every resource (live ∪ state), keyed within kind, into the four buckets.
 * Coverage % = managed / (managed + unmanaged); stale and excluded never enter it.
 */
export function computeCoverage(
  live: ParsedResource[],
  state: ParsedResource[],
): CoverageReport {
  const names = buildNameMap(live, state);
  const liveByKind = indexByKind(live);
  const stateByKind = indexByKind(state);

  // App ids present in state — an app there is `managed`, hence Terraform-manageable, so its
  // auth-policy reference keeps that policy out of the excluded bucket.
  const stateAppKeys = new Set<string>(stateByKind.get("App")?.keys() ?? []);
  const ctx = buildLiveContext(live, stateAppKeys);

  const items: CoverageItem[] = [];

  for (const kind of KIND_ORDER) {
    const liveMap = liveByKind.get(kind);
    const stateMap = stateByKind.get(kind);
    if (!liveMap && !stateMap) continue;

    const keys = new Set<string>([
      ...(liveMap ? liveMap.keys() : []),
      ...(stateMap ? stateMap.keys() : []),
    ]);

    for (const key of keys) {
      const liveR = liveMap?.get(key);
      const stateR = stateMap?.get(key);

      // ORDER IS LOAD-BEARING: presence decides managed/stale first; exclusion is only
      // consulted for live-only records. Do not reorder.
      if (liveR && stateR) {
        items.push(makeItem(liveR, "managed", names, undefined, stateR));
      } else if (stateR) {
        items.push(makeItem(stateR, "stale", names, undefined, stateR));
      } else if (liveR) {
        const reason = exclusionReason(liveR, ctx);
        items.push(makeItem(liveR, reason ? "excluded" : "unmanaged", names, reason ?? undefined));
      }
    }
  }

  items.sort((a, b) => {
    const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    const byBucket = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (byBucket !== 0) return byBucket;
    return a.key.localeCompare(b.key);
  });

  const perKind = KIND_ORDER.map((kind) => ({
    kind,
    ...countBuckets(items.filter((i) => i.kind === kind)),
  })).filter((k) => k.managed + k.unmanaged + k.stale + k.excluded > 0);

  return { perKind, overall: countBuckets(items), items };
}
