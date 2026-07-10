/**
 * Seeded synthetic-scale graph generator for M6 scale tests. NOT a committed fixture — built
 * programmatically per run, deterministic (seeded PRNG), never real tenant data. Includes
 * heavy-tail hubs so hub-truncation is exercised.
 */

import type { Edge, GraphNode, OktaGraph } from "../src/core/model.js";

/** mulberry32 — small deterministic PRNG (no Math.random, so runs are reproducible). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  groups?: number;
  apps?: number;
  assignments?: number;
  seed?: number;
  /** Inject a group that grants this many apps (a hub). Default 800. */
  hubGroupFanout?: number;
  /** Inject an app granted by this many groups (a hub). Default 400. */
  hubAppFanin?: number;
  /** Add this many AppAuthPolicy nodes (`p0`..). Default 0 — existing counts unchanged. */
  authPolicies?: number;
  /** Share of apps (0..1) given a seeded `protects` edge, skewed ~70% toward `p0` so peer sets
   * have dominant policies. Default 0. Requires `authPolicies` > 0 to have any effect. */
  protectsShare?: number;
}

/** Build a synthetic org: `groups` + `apps` nodes, `assignments` grants edges, plus two hubs. */
export function syntheticGraph(options: SyntheticOptions = {}): OktaGraph {
  const nGroups = options.groups ?? 10_000;
  const nApps = options.apps ?? 5_000;
  const nAssign = options.assignments ?? 60_000;
  const hubGroupFanout = options.hubGroupFanout ?? 800;
  const hubAppFanin = options.hubAppFanin ?? 400;
  const rand = rng(options.seed ?? 42);

  const nodes: GraphNode[] = [];
  for (let i = 0; i < nGroups; i++) {
    nodes.push({ kind: "Group", id: `g${i}`, name: `Group ${i}`, address: "x" });
  }
  for (let i = 0; i < nApps; i++) {
    nodes.push({ kind: "App", id: `a${i}`, name: `App ${i}`, address: "x", appType: "okta_app_oauth" });
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();
  const grant = (g: number, a: number): void => {
    const key = `${g}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ kind: "grants", from: `g${g}`, to: `a${a}` });
  };

  // Hubs: group g0 fans out to many apps; app a0 fans in from many groups.
  for (let a = 0; a < Math.min(hubGroupFanout, nApps); a++) grant(0, a);
  for (let g = 0; g < Math.min(hubAppFanin, nGroups); g++) grant(g, 0);

  // Random remainder up to the assignment target.
  let guard = nAssign * 4;
  while (edges.length < nAssign && guard-- > 0) {
    grant(Math.floor(rand() * nGroups), Math.floor(rand() * nApps));
  }

  // Optional auth-policy layer (off by default so existing scale tests keep their exact counts):
  // `protectsShare` of apps get one `protects` edge, skewed toward p0 so dominants exist.
  const nPolicies = options.authPolicies ?? 0;
  const protectsShare = options.protectsShare ?? 0;
  if (nPolicies > 0 && protectsShare > 0) {
    for (let i = 0; i < nPolicies; i++) {
      nodes.push({ kind: "AppAuthPolicy", id: `p${i}`, name: `Policy ${i}`, address: "x" });
    }
    for (let i = 0; i < nApps; i++) {
      if (rand() >= protectsShare) continue;
      const p = nPolicies === 1 || rand() < 0.7 ? 0 : 1 + Math.floor(rand() * (nPolicies - 1));
      edges.push({ kind: "protects", from: `p${p}`, to: `a${i}` });
    }
  }

  return { nodes, edges };
}
