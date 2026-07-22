/**
 * rank-risk: rank apps and groups by an opinionated composite of three signals an IT engineer
 * cares about, so "widest reach, weakest gate, not in Terraform" sorts first.
 *
 * PURE — a consumer of the graph traversal (`src/core/access-paths`) and, optionally, a coverage
 * report. No I/O. Drives BOTH the `risk` CLI command and the viewer's sorted inventory (one
 * ranking, two renderers).
 *
 * The three signals — each surfaced on the row so the ranking is legible, not a black box:
 *  1. REACH — apps a group grants / groups that grant an app (blast radius).
 *  2. GATE PRIOR — org-default app policy / no session policy = `default`; a custom policy =
 *     `custom`. This is a documented PRIOR, not a proven ordering: org-default is more-often-than-
 *     not the looser gate, so it scores as higher-risk — but the model carries no rule/factor data
 *     (M15), so this flags a divergence, NOT a proven weakness. ("org default" is NOT
 *     "unprotected" — it's the org-wide default app sign-on policy.)
 *  3. IaC STATUS — managed vs not-in-Terraform, from coverage. Optional: coverage is a two-input
 *     reconciliation (live vs state), so when it's absent the IaC weight is neutralized.
 */

import type { OktaGraph } from "../core/model.js";
import type { CoverageBucket, SlimCoverageReport } from "./coverage.js";

/** Score weights. Multiplicative so "wide AND default-gated AND unmanaged" compounds. The gate
 * multiplier encodes a PRIOR (org-default is the looser gate more often than not), not proof —
 * M15's factor bands replace it with evidence. Pinned at the M8 Phase-A checkpoint against the
 * fixture oracle. */
const DEFAULT_GATE_MULT = 2;
const UNMANAGED_MULT = 2;

export type GateLabel = "org-default" | "custom" | "none" | "session-policy";

export interface RiskRow {
  id: string;
  kind: "App" | "Group";
  name: string;
  /** Signal 1: blast radius (groups granting an app / apps a group grants). */
  reach: number;
  /** Signal 2: the specific gate (factual label). */
  gate: GateLabel;
  /** Whether the gate is the org default (`default`) or a custom policy (`custom`). A scoring
   * PRIOR — org-default is more-often-than-not the looser gate — not a proven weak/strong ordering. */
  gatePrior: "default" | "custom";
  /**
   * The id of the App's gating auth policy (a custom `protects` edge), or `null` for the org
   * default; `undefined` on Group rows (their gate is a session policy — M15 D2 deferred). Carried
   * so a renderer can band the gate from captured rules (Phase C) without re-walking the graph.
   */
  gatePolicyId?: string | null;
  /** Signal 3: IaC coverage bucket, or "unknown" when no coverage report was supplied. */
  iac: CoverageBucket | "unknown";
  /** Composite risk score (higher = attend first). See weights above. */
  score: number;
}

/** Build id -> bucket for App/Group items only (their coverage `key` IS the node id). */
function bucketByNodeId(coverage?: SlimCoverageReport): Map<string, CoverageBucket> {
  const m = new Map<string, CoverageBucket>();
  if (!coverage) return m;
  for (const item of coverage.items) {
    if (item.kind === "App" || item.kind === "Group") m.set(item.key, item.bucket);
  }
  return m;
}

function score(reach: number, gatePrior: "default" | "custom", iac: CoverageBucket | "unknown"): number {
  const gateMult = gatePrior === "default" ? DEFAULT_GATE_MULT : 1;
  const iacMult = iac === "unmanaged" ? UNMANAGED_MULT : 1;
  return reach * gateMult * iacMult;
}

/**
 * Add `to` to the set keyed by `from` (a small adjacency-set builder). Deduping via Set matches
 * the per-subject traversal helpers, which dedupe a repeated (group, app) grant to one.
 */
function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

/**
 * Rank every App and Group by composite risk, highest first. `coverage` is optional — without it
 * every row's `iac` is "unknown" and the IaC weight is neutral (ranking = reach × gate only).
 * Ties break by reach desc, then name asc, for deterministic output.
 *
 * O(nodes + edges): all three signals are precomputed in single passes, then rows are assembled in
 * one pass — never the per-subject traversal-in-a-loop that would be O(nodes × edges) at scale.
 */
export function rankRisk(graph: OktaGraph, coverage?: SlimCoverageReport): RiskRow[] {
  const buckets = bucketByNodeId(coverage);

  // Reach — deduped `grants` degree in one pass: apps a group grants, groups that grant an app.
  const appsByGroup = new Map<string, Set<string>>();
  const groupsByApp = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind === "grants") {
      addToSet(appsByGroup, e.from, e.to);
      addToSet(groupsByApp, e.to, e.from);
    }
  }

  // Gate — a `protects`/`appliesTo` edge counts only if its policy node actually exists (matches
  // `authPolicyForApp` / `sessionPolicyForGroup`). Collect policy ids, then mark gated targets.
  const authPolicyIds = new Set<string>();
  const sessionPolicyIds = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === "AppAuthPolicy") authPolicyIds.add(n.id);
    else if (n.kind === "GlobalSessionPolicy") sessionPolicyIds.add(n.id);
  }
  // app id -> its custom auth policy id (first valid `protects` wins, matching buildPeerIndex).
  const policyByApp = new Map<string, string>();
  const groupsWithSession = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind === "protects" && authPolicyIds.has(e.from) && !policyByApp.has(e.to)) policyByApp.set(e.to, e.from);
    else if (e.kind === "appliesTo" && sessionPolicyIds.has(e.from)) groupsWithSession.add(e.to);
  }

  const rows: RiskRow[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "App") {
      const reach = groupsByApp.get(node.id)?.size ?? 0;
      const gatePolicyId = policyByApp.get(node.id) ?? null;
      const custom = gatePolicyId !== null;
      const gate: GateLabel = custom ? "custom" : "org-default";
      const gatePrior = custom ? "custom" : "default";
      const iac = buckets.get(node.id) ?? "unknown";
      rows.push({ id: node.id, kind: "App", name: node.name, reach, gate, gatePrior, gatePolicyId, iac, score: score(reach, gatePrior, iac) });
    } else if (node.kind === "Group") {
      const reach = appsByGroup.get(node.id)?.size ?? 0;
      const hasSession = groupsWithSession.has(node.id);
      const gate: GateLabel = hasSession ? "session-policy" : "none";
      const gatePrior = hasSession ? "custom" : "default";
      const iac = buckets.get(node.id) ?? "unknown";
      rows.push({ id: node.id, kind: "Group", name: node.name, reach, gate, gatePrior, iac, score: score(reach, gatePrior, iac) });
    }
  }

  rows.sort((a, b) => b.score - a.score || b.reach - a.reach || a.name.localeCompare(b.name));
  return rows;
}
