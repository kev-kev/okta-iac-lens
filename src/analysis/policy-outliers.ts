/**
 * policy-outliers: find apps whose auth policy DIVERGES from the dominant policy of their peer
 * set, where a peer set is "the apps granted to the same group" (same audience, so the weakest
 * gate among them is the effective exposure for that audience).
 *
 * PURE — a consumer of the graph only. No I/O. Drives BOTH the `outliers` CLI command and the
 * viewer's outliers table (one analysis, two renderers), like rank-risk.
 *
 * What "divergence" means here — and, deliberately, what it does NOT mean:
 *  - We compare WHICH auth policy applies, never policy CONTENTS. The model carries no rule /
 *    factor / re-auth data (M10 scope decision), so "weaker-than-peers" is exactly rank-risk's
 *    binary: org-default while ≥2/3 of peers sit behind a custom policy. Custom-vs-custom
 *    mismatches are reported as "differs-from-peers" — the relative strength is unknown.
 *  - ASYMMETRY, by design: an app behind a CUSTOM policy whose peers are predominantly
 *    org-default is NEVER flagged. That's the expected crown-jewel pattern (one hardened app
 *    among ordinary ones); flagging it would train users to ignore the report.
 *  - "Org default" is NOT "unprotected" — it's the org-wide default app sign-on policy.
 *
 * O(nodes + edges): peer sets are the grants adjacency (Σ|peer set| = O(edges)), policies and
 * names are single passes, plus O(F log F) sorting where F ≤ edges.
 */

import type { GraphNode, OktaGraph } from "../core/model.js";

/** A peer set is evaluated only with ≥ this many apps — below 3 there is no meaningful majority. */
export const MIN_PEERS = 3;
/** Per-app evidence is bounded (a hub app can sit in hundreds of peer sets); score counts ALL. */
export const EVIDENCE_CAP = 8;
/** Score weights, echoing rank-risk's WEAK_GATE_MULT: the weaker-direction divergence counts double. */
const WEAKER_MULT = 2;
const DIFFERS_MULT = 1;

export type OutlierSeverity = "weaker-than-peers" | "differs-from-peers";

/** One divergent peer set: "in {groupName} ({peerCount} apps): {dominantCount}/{peerCount} peers behind {dominantPolicyName}". */
export interface OutlierFinding {
  groupId: string;
  groupName: string;
  /** Apps this group grants (including the outlier app itself). */
  peerCount: number;
  /** The dominant policy is always a CUSTOM policy — org-default-dominant sets flag nothing. */
  dominantPolicyId: string;
  dominantPolicyName: string;
  /** Peers behind the dominant policy — the "9" in "9/11 peers behind Strict-Auth". */
  dominantCount: number;
  severity: OutlierSeverity;
}

export interface OutlierRow {
  appId: string;
  appName: string;
  /** null = org default app sign-on policy (NEVER "no auth"). */
  appPolicyId: string | null;
  appPolicyName: string | null;
  /** Max severity across all findings. */
  severity: OutlierSeverity;
  /** Σ severityWeight × dominantCount over ALL divergent peer sets (not just the kept evidence). */
  score: number;
  /** Total divergent peer sets — may exceed findings.length (evidence is capped). */
  findingCount: number;
  /** Top EVIDENCE_CAP findings by peerCount desc, then group name asc. */
  findings: OutlierFinding[];
}

/**
 * The report carries evaluation stats so an empty result can explain itself ("evaluated 0 peer
 * groups" is a very different no than "40 groups, all conforming").
 */
export interface OutlierReport {
  rows: OutlierRow[];
  /** Groups with ≥ minPeers granted apps. */
  groupsEvaluated: number;
  /** Of those, how many had a unique ≥2/3 dominant policy (org-default dominants included). */
  groupsWithDominant: number;
  /** Echo of MIN_PEERS so renderers can explain the rule without importing constants. */
  minPeers: number;
}

/** Add `to` to the set keyed by `from` — Set dedupes a repeated (group, app) grant to one. */
function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

/**
 * Find every app that diverges from the dominant auth policy of at least one of its peer sets,
 * ranked by score desc → findingCount desc → name asc → id asc (deterministic).
 */
export function findPolicyOutliers(graph: OktaGraph): OutlierReport {
  const nodeById = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  // Peer sets — deduped grants adjacency, counting only edges whose endpoints are real
  // Group/App nodes (mirrors the viewer's indexes.ts guard; dangling ids can't become rows).
  const appsByGroup = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (
      e.kind === "grants" &&
      nodeById.get(e.from)?.kind === "Group" &&
      nodeById.get(e.to)?.kind === "App"
    ) {
      addToSet(appsByGroup, e.from, e.to);
    }
  }

  // App -> auth policy. A `protects` edge counts only if its policy node exists (rank-risk's
  // guard); with duplicates, the FIRST edge wins — pinned for determinism.
  const policyByApp = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.kind === "protects" && nodeById.get(e.from)?.kind === "AppAuthPolicy" && !policyByApp.has(e.to)) {
      policyByApp.set(e.to, e.from);
    }
  }

  let groupsEvaluated = 0;
  let groupsWithDominant = 0;
  // Per-app accumulation across peer sets (an app can diverge in many groups).
  const acc = new Map<string, { score: number; severity: OutlierSeverity; findings: OutlierFinding[] }>();

  for (const [groupId, peers] of appsByGroup) {
    if (peers.size < MIN_PEERS) continue;
    groupsEvaluated++;

    // Count peers per policy key; `null` (a valid Map key) = org default.
    const counts = new Map<string | null, number>();
    for (const appId of peers) {
      const key = policyByApp.get(appId) ?? null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Unique mode covering ≥ 2/3 of peers (integer-safe). A tie means no dominant.
    let modeKey: string | null = null;
    let modeCount = 0;
    let tied = false;
    for (const [key, count] of counts) {
      if (count > modeCount) {
        modeKey = key;
        modeCount = count;
        tied = false;
      } else if (count === modeCount) {
        tied = true;
      }
    }
    if (tied || 3 * modeCount < 2 * peers.size) continue;
    groupsWithDominant++;

    // Org-default dominant flags nothing: a custom-gated app among default peers is the
    // crown-jewel pattern, not an outlier (see module header).
    if (modeKey === null) continue;

    const groupName = nodeById.get(groupId)?.name ?? groupId;
    const dominantPolicyName = nodeById.get(modeKey)?.name ?? modeKey;
    for (const appId of peers) {
      const appKey = policyByApp.get(appId) ?? null;
      if (appKey === modeKey) continue;
      const severity: OutlierSeverity = appKey === null ? "weaker-than-peers" : "differs-from-peers";
      const finding: OutlierFinding = {
        groupId,
        groupName,
        peerCount: peers.size,
        dominantPolicyId: modeKey,
        dominantPolicyName,
        dominantCount: modeCount,
        severity,
      };
      let entry = acc.get(appId);
      if (!entry) acc.set(appId, (entry = { score: 0, severity, findings: [] }));
      entry.score += (severity === "weaker-than-peers" ? WEAKER_MULT : DIFFERS_MULT) * modeCount;
      if (severity === "weaker-than-peers") entry.severity = "weaker-than-peers";
      entry.findings.push(finding);
    }
  }

  const rows: OutlierRow[] = [];
  for (const [appId, entry] of acc) {
    const appPolicyId = policyByApp.get(appId) ?? null;
    entry.findings.sort(
      (a, b) => b.peerCount - a.peerCount || a.groupName.localeCompare(b.groupName) || a.groupId.localeCompare(b.groupId),
    );
    rows.push({
      appId,
      appName: nodeById.get(appId)?.name ?? appId,
      appPolicyId,
      appPolicyName: appPolicyId ? (nodeById.get(appPolicyId)?.name ?? appPolicyId) : null,
      severity: entry.severity,
      score: entry.score,
      findingCount: entry.findings.length,
      findings: entry.findings.slice(0, EVIDENCE_CAP),
    });
  }
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.findingCount - a.findingCount ||
      a.appName.localeCompare(b.appName) ||
      a.appId.localeCompare(b.appId),
  );

  return { rows, groupsEvaluated, groupsWithDominant, minPeers: MIN_PEERS };
}
