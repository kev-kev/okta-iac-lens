/**
 * gen-scale-envelope: write a synthetic enterprise-scale graph envelope for the web viewer, so
 * the "bounded focus view" screenshot is reproducible. Reuses the seeded synthetic generator
 * (`test/synthetic.ts`) and the viewer envelope format (`src/render/envelope.ts`).
 *
 * The output lands in `generated/` (gitignored) — never a committed multi-MB fixture, never real
 * tenant data (CLAUDE.md scale-strategy rail). Run: `npm run gen:scale`, then `npm run web` and
 * "Open graph…" the written file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { syntheticGraph } from "../test/synthetic.js";
import { makeEnvelope } from "../src/render/envelope.js";

const OUT = "generated/scale-envelope.json";

// Default synthetic org: 10k groups + 5k apps (= the "15000 nodes" the viewer header shows),
// 60k assignment edges, plus heavy-tail hubs (group 0 -> 800 apps) that exercise hub truncation.
const graph = syntheticGraph();
const envelope = makeEnvelope(graph, "okta", new Date().toISOString());

mkdirSync("generated", { recursive: true });
writeFileSync(OUT, JSON.stringify(envelope));

console.error(
  `Wrote ${graph.nodes.length} nodes / ${graph.edges.length} edges to ${OUT}. ` +
    `Now: npm run web -> "Open graph…" -> ${OUT} -> focus "Group 0".`,
);
