/**
 * buildOutlierMatrix oracle: bounded Group×Policy heatmap. Columns ≤ 8 (top policies + Other +
 * Org default), rows ≤ MAX_MATRIX_ROWS, cell samples capped, and — crucially — the "dominant" cell
 * and divergence severity agree with findPolicyOutliers (both read the shared peer index).
 */

import { describe, expect, it } from "vitest";
import type { Edge, GraphNode, OktaGraph } from "../src/core/model.js";
import {
  buildOutlierMatrix,
  CELL_APP_CAP,
  MAX_MATRIX_POLICIES,
  MAX_MATRIX_ROWS,
  ORG_DEFAULT_COL,
  OTHER_COL,
} from "../src/render/web/outlier-matrix.js";
import { findPolicyOutliers } from "../src/analysis/policy-outliers.js";
import { syntheticGraph } from "./synthetic.js";

function outlierGraph(spec: {
  grants: Record<string, string[]>;
  protects?: Record<string, string[]>;
}): OktaGraph {
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  const appIds = new Set<string>();
  for (const [groupId, apps] of Object.entries(spec.grants)) {
    nodes.push({ kind: "Group", id: groupId, name: groupId, address: "x" });
    for (const a of apps) {
      appIds.add(a);
      edges.push({ kind: "grants", from: groupId, to: a });
    }
  }
  for (const a of appIds) nodes.push({ kind: "App", id: a, name: a, address: "x", appType: "okta_app_oauth" });
  for (const [policyId, apps] of Object.entries(spec.protects ?? {})) {
    nodes.push({ kind: "AppAuthPolicy", id: policyId, name: policyId, address: "x" });
    for (const a of apps) edges.push({ kind: "protects", from: policyId, to: a });
  }
  return { nodes, edges };
}

const cellFor = (matrix: ReturnType<typeof buildOutlierMatrix>, rowId: string, colId: string) => {
  const row = matrix.rows.find((r) => r.groupId === rowId)!;
  const i = matrix.columns.findIndex((c) => c.id === colId);
  return row.cells[i]!;
};

describe("buildOutlierMatrix", () => {
  it("marks the dominant custom cell and flags the org-default cell as weaker-than-peers", () => {
    const matrix = buildOutlierMatrix(
      outlierGraph({ grants: { G: ["x", "b1", "b2", "b3"] }, protects: { P1: ["b1", "b2", "b3"] } }),
    );
    // Columns: [P1, Other custom, Org default]
    expect(matrix.columns.map((c) => c.id)).toEqual(["P1", OTHER_COL, ORG_DEFAULT_COL]);
    expect(matrix.columns.every((c, i) => matrix.rows[0]!.cells.length === matrix.columns.length)).toBe(true);

    const p1 = cellFor(matrix, "G", "P1");
    expect(p1.count).toBe(3);
    expect(p1.share).toBeCloseTo(0.75);
    expect(p1.isDominant).toBe(true);
    expect(p1.severity).toBeUndefined();

    const def = cellFor(matrix, "G", ORG_DEFAULT_COL);
    expect(def.count).toBe(1);
    expect(def.appIds).toEqual(["x"]);
    expect(def.severity).toBe("weaker-than-peers");

    // Agreement with the ranked table: x is the weaker-than-peers outlier there too.
    expect(findPolicyOutliers(outlierGraph({ grants: { G: ["x", "b1", "b2", "b3"] }, protects: { P1: ["b1", "b2", "b3"] } })).rows[0]!.appId).toBe("x");
  });

  it("bounds columns to the top policies plus Other + Org default", () => {
    // 8 custom policies, each protecting a distinct app in one big peer set.
    const apps = Array.from({ length: 9 }, (_, i) => `a${i}`);
    const protects: Record<string, string[]> = {};
    for (let i = 0; i < 8; i++) protects[`P${i}`] = [`a${i}`]; // a8 is org-default
    const matrix = buildOutlierMatrix(outlierGraph({ grants: { G: apps }, protects }));
    expect(matrix.columns.length).toBe(MAX_MATRIX_POLICIES + 2);
    expect(matrix.columns.filter((c) => !c.synthetic).length).toBe(MAX_MATRIX_POLICIES);
    // The two policies past the top-6 fold into Other.
    expect(cellFor(matrix, "G", OTHER_COL).count).toBe(2);
  });

  it("never flags cells when the dominant is org default (crown-jewel asymmetry)", () => {
    const matrix = buildOutlierMatrix(
      outlierGraph({ grants: { G: ["d1", "d2", "d3", "hardened"] }, protects: { P1: ["hardened"] } }),
    );
    for (const row of matrix.rows) for (const cell of row.cells) expect(cell.severity).toBeUndefined();
    expect(cellFor(matrix, "G", ORG_DEFAULT_COL).isDominant).toBe(true);
  });

  it("includes a no-dominant (tie) group with no dominant or divergent cell", () => {
    const matrix = buildOutlierMatrix(
      outlierGraph({ grants: { G: ["a1", "a2", "b1", "b2"] }, protects: { P1: ["a1", "a2"], P2: ["b1", "b2"] } }),
    );
    const row = matrix.rows.find((r) => r.groupId === "G")!;
    expect(row.cells.some((c) => c.isDominant)).toBe(false);
    expect(row.cells.some((c) => c.severity)).toBe(false);
  });

  it("stays bounded on an enterprise-scale org (rows, columns, cell samples, runtime)", () => {
    const graph = syntheticGraph({ authPolicies: 20, protectsShare: 0.8 });
    const t0 = performance.now();
    const matrix = buildOutlierMatrix(graph);
    expect(performance.now() - t0).toBeLessThan(1000);

    expect(matrix.columns.length).toBeLessThanOrEqual(MAX_MATRIX_POLICIES + 2);
    expect(matrix.rows.length).toBeLessThanOrEqual(MAX_MATRIX_ROWS);
    expect(matrix.hiddenRowCount).toBeGreaterThan(0);
    for (const row of matrix.rows) {
      expect(row.cells.length).toBe(matrix.columns.length);
      for (const cell of row.cells) expect(cell.appIds.length).toBeLessThanOrEqual(CELL_APP_CAP);
    }
  });
});
