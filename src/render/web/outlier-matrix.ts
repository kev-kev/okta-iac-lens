/**
 * outlier-matrix: the Group×Policy heatmap model (M10 stretch). PURE, DOM-free — the cohorts.ts
 * pattern: graph in, a bounded table of cells out. Reuses the SAME peer sets and dominance rule
 * as the outliers table (`buildPeerIndex` / `dominantPolicy`), so the highlighted "dominant" cell
 * and the flagged divergence never disagree with the ranked list.
 *
 * Bounded by construction (scale rail — no render depends on org size):
 *  - columns ≤ 8: the top MAX_MATRIX_POLICIES custom policies by protected-app count, then a
 *    collapsed "Other" (remaining custom policies) and "Org default".
 *  - rows: evaluated groups (≥ MIN_PEERS apps) by peer-set size desc, top MAX_MATRIX_ROWS, with
 *    `hiddenRowCount` for the rest.
 *  - cell `appIds` capped at CELL_APP_CAP (a drill-in sample, not the full membership).
 */

import type { OktaGraph } from "../../core/model.js";
import {
  buildPeerIndex,
  dominantPolicy,
  MIN_PEERS,
  policyCounts,
  type OutlierSeverity,
} from "../../analysis/policy-outliers.js";

export const MAX_MATRIX_POLICIES = 6;
export const MAX_MATRIX_ROWS = 30;
export const CELL_APP_CAP = 50;

/** Column ids for the two synthetic (non-policy) columns; real columns use the policy id. */
export const ORG_DEFAULT_COL = "__org_default__";
export const OTHER_COL = "__other__";

export interface MatrixColumn {
  id: string;
  label: string;
  /** True for the two synthetic columns (org default / other) — they aren't a single policy. */
  synthetic: boolean;
}

export interface MatrixCell {
  count: number;
  /** count / peerCount for the row — drives the heat intensity. */
  share: number;
  /** A capped sample of the apps in this cell (for drill-in). */
  appIds: string[];
  isDominant: boolean;
  /** Set only when these apps diverge from a CUSTOM dominant (the flagged case). */
  severity?: OutlierSeverity;
}

export interface MatrixRow {
  groupId: string;
  groupName: string;
  peerCount: number;
  /** Cells aligned 1:1 with `columns`. */
  cells: MatrixCell[];
}

export interface OutlierMatrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** Evaluated groups beyond MAX_MATRIX_ROWS not shown. */
  hiddenRowCount: number;
  minPeers: number;
}

export function buildOutlierMatrix(graph: OktaGraph): OutlierMatrix {
  const { nodeById, appsByGroup, policyByApp } = buildPeerIndex(graph);

  // Column policies: rank custom policies by how many apps they protect (reuses the cohorts.ts
  // "top-k by member count" idea), take the top MAX_MATRIX_POLICIES; the rest fold into "Other".
  const appsPerPolicy = new Map<string, number>();
  for (const policyId of policyByApp.values()) {
    appsPerPolicy.set(policyId, (appsPerPolicy.get(policyId) ?? 0) + 1);
  }
  const topPolicies = [...appsPerPolicy.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (nodeById.get(a[0])?.name ?? a[0]).localeCompare(nodeById.get(b[0])?.name ?? b[0]) ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, MAX_MATRIX_POLICIES)
    .map(([id]) => id);
  const topSet = new Set(topPolicies);

  const columns: MatrixColumn[] = [
    ...topPolicies.map((id) => ({ id, label: nodeById.get(id)?.name ?? id, synthetic: false })),
    { id: OTHER_COL, label: "Other custom", synthetic: true },
    { id: ORG_DEFAULT_COL, label: "Org default", synthetic: true },
  ];

  /** Which column an app's policy key lands in. */
  const columnOf = (key: string | null): string =>
    key === null ? ORG_DEFAULT_COL : topSet.has(key) ? key : OTHER_COL;

  // Evaluated rows, biggest audience first (largest exposure), bounded to MAX_MATRIX_ROWS.
  const evaluated = [...appsByGroup.entries()].filter(([, peers]) => peers.size >= MIN_PEERS);
  evaluated.sort(
    (a, b) =>
      b[1].size - a[1].size ||
      (nodeById.get(a[0])?.name ?? a[0]).localeCompare(nodeById.get(b[0])?.name ?? b[0]) ||
      a[0].localeCompare(b[0]),
  );
  const shown = evaluated.slice(0, MAX_MATRIX_ROWS);

  const rows: MatrixRow[] = shown.map(([groupId, peers]) => {
    const dominant = dominantPolicy(policyCounts(peers, policyByApp), peers.size);
    const dominantCol = dominant ? columnOf(dominant.key) : null;
    // Divergence severity is only meaningful against a CUSTOM dominant (org-default dominant =
    // crown-jewel asymmetry: nothing is flagged, matching the ranked table).
    const flagsDivergence = dominant != null && dominant.key !== null;

    // Bucket the peer apps into columns once.
    const byCol = new Map<string, string[]>();
    for (const appId of peers) {
      const col = columnOf(policyByApp.get(appId) ?? null);
      const list = byCol.get(col);
      if (list) list.push(appId);
      else byCol.set(col, [appId]);
    }

    const cells: MatrixCell[] = columns.map((col) => {
      const appIds = byCol.get(col.id) ?? [];
      const isDominant = dominantCol === col.id;
      const divergent = flagsDivergence && !isDominant && appIds.length > 0;
      return {
        count: appIds.length,
        share: peers.size === 0 ? 0 : appIds.length / peers.size,
        appIds: appIds.slice(0, CELL_APP_CAP),
        isDominant,
        ...(divergent
          ? { severity: (col.id === ORG_DEFAULT_COL ? "default-while-peers-custom" : "differs-from-peers") as OutlierSeverity }
          : {}),
      };
    });

    return {
      groupId,
      groupName: nodeById.get(groupId)?.name ?? groupId,
      peerCount: peers.size,
      cells,
    };
  });

  return {
    columns,
    rows,
    hiddenRowCount: Math.max(0, evaluated.length - shown.length),
    minPeers: MIN_PEERS,
  };
}
