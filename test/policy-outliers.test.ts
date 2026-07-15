/**
 * findPolicyOutliers oracle: peer-set divergence over hand-built graphs (the committed fixture
 * cannot produce outliers — Engineering's 2-app peer set is below MIN_PEERS, which makes it the
 * negative oracle), plus the synthetic-scale invariants (evidence cap, ordering, runtime).
 */

import { describe, expect, it } from "vitest";
import type { Edge, GraphNode, OktaGraph } from "../src/core/model.js";
import {
  EVIDENCE_CAP,
  findPolicyOutliers,
  MIN_PEERS,
} from "../src/analysis/policy-outliers.js";
import { renderOutliers } from "../src/render/cli.js";
import { graphFromFixture } from "./fixture.js";
import { syntheticGraph } from "./synthetic.js";

/**
 * Compact graph builder: `grants` maps group id -> granted app ids; `protects` maps policy id ->
 * protected app ids. Node names = ids. `danglingPolicies` declares protects edges whose policy
 * node is deliberately omitted; `extraEdges` appends raw edges (duplicate tests).
 */
function outlierGraph(spec: {
  grants: Record<string, string[]>;
  protects?: Record<string, string[]>;
  danglingPolicies?: string[];
  extraEdges?: Edge[];
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
  for (const a of appIds) {
    nodes.push({ kind: "App", id: a, name: a, address: "x", appType: "okta_app_oauth" });
  }
  for (const [policyId, apps] of Object.entries(spec.protects ?? {})) {
    if (!spec.danglingPolicies?.includes(policyId)) {
      nodes.push({ kind: "AppAuthPolicy", id: policyId, name: policyId, address: "x" });
    }
    for (const a of apps) edges.push({ kind: "protects", from: policyId, to: a });
  }
  edges.push(...(spec.extraEdges ?? []));
  return { nodes, edges };
}

describe("findPolicyOutliers (hand-built oracles)", () => {
  it("flags an org-default app among custom-gated peers as default-while-peers-custom", () => {
    // 4 peers, 3 behind P1, 1 org-default: dominant P1 (3/4 >= 2/3).
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["x", "b1", "b2", "b3"] },
        protects: { P1: ["b1", "b2", "b3"] },
      }),
    );
    expect(report.groupsEvaluated).toBe(1);
    expect(report.groupsWithDominant).toBe(1);
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.appId).toBe("x");
    expect(row.appPolicyId).toBeNull();
    expect(row.severity).toBe("default-while-peers-custom");
    expect(row.score).toBe(6); // 2 (default-vs-custom prior) × 3 (dominantCount)
    expect(row.findings).toEqual([
      {
        groupId: "G",
        groupName: "G",
        peerCount: 4,
        dominantPolicyId: "P1",
        dominantPolicyName: "P1",
        dominantCount: 3,
        severity: "default-while-peers-custom",
      },
    ]);
  });

  it("evaluates exactly-MIN_PEERS sets (2/3 = dominant) and skips smaller ones", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["x1", "x2", "y"], H: ["a", "b"] }, // H is below MIN_PEERS
        protects: { P1: ["x1", "x2"] },
      }),
    );
    expect(MIN_PEERS).toBe(3);
    expect(report.groupsEvaluated).toBe(1); // H never evaluated
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.appId).toBe("y");
    expect(report.rows[0]!.score).toBe(4); // 2 × dominantCount 2
  });

  it("a tie for the mode means no dominant and no outliers", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["a1", "a2", "b1", "b2"] },
        protects: { P1: ["a1", "a2"], P2: ["b1", "b2"] },
      }),
    );
    expect(report.groupsEvaluated).toBe(1);
    expect(report.groupsWithDominant).toBe(0);
    expect(report.rows).toEqual([]);
  });

  it("never flags a custom-gated app among org-default peers (crown-jewel asymmetry)", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["d1", "d2", "d3", "hardened"] },
        protects: { P1: ["hardened"] },
      }),
    );
    // Org-default IS the dominant (3/4) — it counts as a dominant, but flags nothing.
    expect(report.groupsWithDominant).toBe(1);
    expect(report.rows).toEqual([]);
  });

  it("custom-vs-custom divergence is differs-from-peers at weight 1", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["a1", "a2", "a3", "z"] },
        protects: { P1: ["a1", "a2", "a3"], P2: ["z"] },
      }),
    );
    const row = report.rows[0]!;
    expect(row.severity).toBe("differs-from-peers");
    expect(row.appPolicyId).toBe("P2");
    expect(row.score).toBe(3); // 1 (differs) × 3 (dominantCount)
  });

  it("aggregates one row per app across peer sets; conforming sets contribute nothing", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: {
          G1: ["x", "b1", "b2", "b3"], // diverges: dominant P1 3/4 → 2×3
          G2: ["x", "b1", "b2"], //        diverges: dominant P1 2/3 → 2×2
          G3: ["x", "d1", "d2"], //        conforms: dominant org-default
        },
        protects: { P1: ["b1", "b2", "b3"] },
      }),
    );
    expect(report.groupsEvaluated).toBe(3);
    expect(report.groupsWithDominant).toBe(3);
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.findingCount).toBe(2);
    expect(row.score).toBe(10);
    // Evidence ordered by peerCount desc: G1 (4 peers) before G2 (3 peers).
    expect(row.findings.map((f) => f.groupId)).toEqual(["G1", "G2"]);
  });

  it("treats a protects edge with a missing policy node as org-default", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["a1", "b1", "b2"] },
        protects: { P1: ["b1", "b2"], GHOST: ["a1"] },
        danglingPolicies: ["GHOST"],
      }),
    );
    const row = report.rows[0]!;
    expect(row.appId).toBe("a1");
    expect(row.appPolicyId).toBeNull(); // the dangling edge never counted
    expect(row.severity).toBe("default-while-peers-custom");
  });

  it("dedupes duplicate grants and lets the first of duplicate protects edges win", () => {
    const report = findPolicyOutliers(
      outlierGraph({
        grants: { G: ["a1", "b1", "b2"] },
        protects: { P1: ["a1", "b1", "b2"], P2: ["a1"] }, // a1: P1 edge first → P1 wins → conforms
        extraEdges: [{ kind: "grants", from: "G", to: "a1" }], // duplicate grant
      }),
    );
    expect(report.rows).toEqual([]); // a1 conforms under first-wins; dupe grant didn't inflate peers
    expect(report.groupsWithDominant).toBe(1);
  });

  it("caps evidence at EVIDENCE_CAP while findingCount and score count everything", () => {
    const n = EVIDENCE_CAP + 2;
    const grants: Record<string, string[]> = {};
    for (let i = 0; i < n; i++) grants[`G${i}`] = ["y", "b1", "b2"];
    const report = findPolicyOutliers(
      outlierGraph({ grants, protects: { P1: ["b1", "b2"] } }),
    );
    const row = report.rows[0]!;
    expect(row.findingCount).toBe(n);
    expect(row.findings).toHaveLength(EVIDENCE_CAP);
    expect(row.score).toBe(n * 2 * 2); // every set: 2 (default-vs-custom prior) × dominantCount 2
  });

  it("negative oracle: the committed fixture has no peer set of MIN_PEERS", () => {
    const report = findPolicyOutliers(graphFromFixture());
    expect(report.groupsEvaluated).toBe(0);
    expect(report.rows).toEqual([]);
  });
});

describe("renderOutliers", () => {
  const outlierReport = findPolicyOutliers(
    outlierGraph({
      grants: { Engineering: ["GitHub", "b1", "b2", "b3"] },
      protects: { "Strict-Auth": ["b1", "b2", "b3"] },
    }),
  );

  it("renders ranked rows with per-finding evidence and the honesty footnote", () => {
    const text = renderOutliers(outlierReport, "text");
    expect(text).toContain("Policy outliers");
    expect(text).toContain("GitHub");
    expect(text).toContain("org default");
    expect(text).toContain("default-while-peers-custom");
    expect(text).toContain("- in Engineering (4 apps): 3/4 peers behind Strict-Auth");
    expect(text).toContain("Evaluated 1 peer group(s); 1 had a dominant policy.");
    expect(text).toContain("not policy contents");
  });

  it("prints the 'prior, not proof' gate caveat so the honesty note can't regress", () => {
    const text = renderOutliers(outlierReport, "text");
    expect(text).toContain("gate strength is a heuristic prior");
    expect(text).toContain("not a proven weakness");
  });

  it("renders the honest empty state with evaluation stats", () => {
    const empty = renderOutliers(findPolicyOutliers(graphFromFixture()), "text");
    expect(empty).toContain("(no outliers)");
    expect(empty).toContain("Evaluated 0 peer group(s); 0 had a dominant policy.");
  });

  it("JSON output round-trips the full report (rows + stats)", () => {
    const parsed = JSON.parse(renderOutliers(outlierReport, "json"));
    expect(parsed).toEqual(outlierReport);
    expect(parsed.minPeers).toBe(MIN_PEERS);
  });

  it("marks capped evidence with an overflow line", () => {
    const n = EVIDENCE_CAP + 2;
    const grants: Record<string, string[]> = {};
    for (let i = 0; i < n; i++) grants[`G${i}`] = ["y", "b1", "b2"];
    const capped = findPolicyOutliers(outlierGraph({ grants, protects: { P1: ["b1", "b2"] } }));
    expect(renderOutliers(capped, "text")).toContain("…and 2 more peer group(s)");
  });
});

describe("findPolicyOutliers (synthetic scale)", () => {
  // 15k nodes + 20 policies over 80% of apps (skewed to p0 so dominants exist).
  const graph = syntheticGraph({ authPolicies: 20, protectsShare: 0.8 });

  it("stays fast, bounded, and deterministically ordered on an enterprise-scale org", () => {
    const t0 = performance.now();
    const report = findPolicyOutliers(graph);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);

    expect(report.rows.length).toBeGreaterThan(0);
    for (const row of report.rows) {
      expect(row.findings.length).toBeLessThanOrEqual(EVIDENCE_CAP);
      expect(row.findingCount).toBeGreaterThanOrEqual(row.findings.length);
    }
    // Ordering invariant: score never increases down the list.
    for (let i = 1; i < report.rows.length; i++) {
      expect(report.rows[i]!.score).toBeLessThanOrEqual(report.rows[i - 1]!.score);
    }
    // Deterministic: a second run yields the identical report.
    expect(findPolicyOutliers(graph)).toEqual(report);
  });
});
