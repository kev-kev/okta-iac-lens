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

export type ResourceKind = ParsedResource["kind"];

/**
 * - `managed`   — in live AND state (counts toward coverage)
 * - `unmanaged` — live only, and Terraform-manageable: the IaC gap (import-block candidate)
 * - `stale`     — state only: deleted out-of-band, or a stale/foreign state file (report only)
 * - `excluded`  — live only, but not Terraform-manageable / Okta-managed noise (out of the denominator)
 */
export type CoverageBucket = "managed" | "unmanaged" | "stale" | "excluded";

export interface CoverageItem {
  kind: ResourceKind;
  /** Within-kind identity: `id` for most kinds, `${appId}/${groupId}` for assignments. */
  key: string;
  /** Human-facing label ("<app> / <group>" for assignments). */
  name: string;
  bucket: CoverageBucket;
  /** Why a live-only record was excluded. Set iff `bucket === "excluded"`. */
  reason?: string;
  /** Underlying record: the live record for managed/unmanaged/excluded, the state record for stale. */
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

/** Stable display/sort order for kinds. */
const KIND_ORDER: ResourceKind[] = [
  "Group",
  "App",
  "AppGroupAssignment",
  "GroupRule",
  "GlobalSessionPolicy",
  "AppAuthPolicy",
];

/** Stable display/sort order for buckets — gaps first, managed last. */
const BUCKET_ORDER: CoverageBucket[] = ["unmanaged", "stale", "excluded", "managed"];

/** Within-kind identity key. Assignments carry no `id`; use the (app, group) pair. */
function keyOf(r: ParsedResource): string {
  return r.kind === "AppGroupAssignment" ? `${r.appId}/${r.groupId}` : r.id;
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
  if (r.kind === "AppGroupAssignment") {
    return `${names.get(r.appId) ?? r.appId} / ${names.get(r.groupId) ?? r.groupId}`;
  }
  return r.name;
}

interface LiveContext {
  /** Non-null `authenticationPolicyId` of every live App — the app-auth policies actually in use. */
  referencedAuthPolicyIds: Set<string>;
}

function buildLiveContext(live: ParsedResource[]): LiveContext {
  const referencedAuthPolicyIds = new Set<string>();
  for (const r of live) {
    if (r.kind === "App" && r.authenticationPolicyId) {
      referencedAuthPolicyIds.add(r.authenticationPolicyId);
    }
  }
  return { referencedAuthPolicyIds };
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
    case "GlobalSessionPolicy":
      return r.system === true
        ? "Okta system global session policy (org default); not managed config"
        : null;
    case "AppAuthPolicy":
      // Non-system, APP-typed policies reach here (the mapper already dropped the rest). One
      // attached to no managed app is Okta-created console noise (Okta Dashboard, etc.).
      return ctx.referencedAuthPolicyIds.has(r.id)
        ? null
        : "Okta-created app access policy attached to no managed app";
    default:
      return null; // App, GroupRule, AppGroupAssignment: no exclusion predicate.
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
): CoverageItem {
  const item: CoverageItem = {
    kind: resource.kind,
    key: keyOf(resource),
    name: nameOf(resource, names),
    bucket,
    resource,
  };
  if (reason) item.reason = reason;
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
  const ctx = buildLiveContext(live);
  const names = buildNameMap(live, state);
  const liveByKind = indexByKind(live);
  const stateByKind = indexByKind(state);

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
        items.push(makeItem(liveR, "managed", names));
      } else if (stateR) {
        items.push(makeItem(stateR, "stale", names));
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
