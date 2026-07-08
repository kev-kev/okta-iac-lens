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
 *  2. GATE STRENGTH — org-default app policy / no session policy = WEAK; a custom policy = STRONG.
 *     ("org default" is NOT "unprotected" — it's the org-wide default; a custom gate is stronger.)
 *  3. IaC STATUS — managed vs not-in-Terraform, from coverage. Optional: coverage is a two-input
 *     reconciliation (live vs state), so when it's absent the IaC weight is neutralized.
 */

import type { AppNode, GroupNode, OktaGraph } from "../core/model.js";
import {
  appsGrantedByGroup,
  authPolicyForApp,
  groupsGrantingApp,
  sessionPolicyForGroup,
} from "../core/access-paths.js";
import type { CoverageBucket, SlimCoverageReport } from "./coverage.js";

/** Score weights. Multiplicative so "wide AND weak AND unmanaged" compounds. Pinned at the M8
 * Phase-A checkpoint against the fixture oracle. */
const WEAK_GATE_MULT = 2;
const UNMANAGED_MULT = 2;

export type GateLabel = "org-default" | "custom" | "none" | "session-policy";

export interface RiskRow {
  id: string;
  kind: "App" | "Group";
  name: string;
  /** Signal 1: blast radius (groups granting an app / apps a group grants). */
  reach: number;
  /** Signal 2: the specific gate, and whether it's weak or strong. */
  gate: GateLabel;
  gateStrength: "weak" | "strong";
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

function score(reach: number, gateStrength: "weak" | "strong", iac: CoverageBucket | "unknown"): number {
  const gateMult = gateStrength === "weak" ? WEAK_GATE_MULT : 1;
  const iacMult = iac === "unmanaged" ? UNMANAGED_MULT : 1;
  return reach * gateMult * iacMult;
}

/**
 * Rank every App and Group by composite risk, highest first. `coverage` is optional — without it
 * every row's `iac` is "unknown" and the IaC weight is neutral (ranking = reach × gate only).
 * Ties break by reach desc, then name asc, for deterministic output.
 */
export function rankRisk(graph: OktaGraph, coverage?: SlimCoverageReport): RiskRow[] {
  const buckets = bucketByNodeId(coverage);
  const rows: RiskRow[] = [];

  for (const node of graph.nodes) {
    if (node.kind === "App") {
      const app = node as AppNode;
      const reach = groupsGrantingApp(graph, app.id).length;
      const custom = authPolicyForApp(graph, app.id) !== null;
      const gate: GateLabel = custom ? "custom" : "org-default";
      const gateStrength = custom ? "strong" : "weak";
      const iac = buckets.get(app.id) ?? "unknown";
      rows.push({ id: app.id, kind: "App", name: app.name, reach, gate, gateStrength, iac, score: score(reach, gateStrength, iac) });
    } else if (node.kind === "Group") {
      const group = node as GroupNode;
      const reach = appsGrantedByGroup(graph, group.id).length;
      const hasSession = sessionPolicyForGroup(graph, group.id) !== null;
      const gate: GateLabel = hasSession ? "session-policy" : "none";
      const gateStrength = hasSession ? "strong" : "weak";
      const iac = buckets.get(group.id) ?? "unknown";
      rows.push({ id: group.id, kind: "Group", name: group.name, reach, gate, gateStrength, iac, score: score(reach, gateStrength, iac) });
    }
  }

  rows.sort((a, b) => b.score - a.score || b.reach - a.reach || a.name.localeCompare(b.name));
  return rows;
}
