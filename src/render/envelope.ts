/**
 * render/envelope: the on-disk interchange format between `export` (CLI writer) and the
 * web viewer (reader). One source of truth for the shape + version so both sides agree.
 *
 * The `graph` value is the UNTRANSFORMED `OktaGraph` (already plain arrays — see model.ts).
 * `makeEnvelope` is pure (the timestamp is passed in, not read here) so it stays testable;
 * the CLI supplies `new Date().toISOString()` at call time.
 */

import type { OktaGraph } from "../core/model.js";
import type { SlimCoverageReport } from "../analysis/coverage.js";

/**
 * Envelope version. Only bump for INCOMPATIBLE changes.
 *
 * Additive changes DON'T bump: a viewer that ignores an added field still renders the graph.
 *  - M5: the optional `coverage` overlay.
 *  - M12: optional `status`/`priority` node fields (App/GroupRule/GlobalSessionPolicy/AppAuthPolicy)
 *    — the viewer reads neither yet, so a v1 file stays valid and a v1 viewer renders a v2 graph.
 *    (M11's synthesis PENCILLED a bump here; the widening turned out additive, exactly like M5,
 *    so it's held at 1. Bump only when a future change — e.g. M15 rule refs — is truly breaking.)
 */
export const ENVELOPE_VERSION = 1;

export type GraphSource = "tfstate" | "okta";

export interface GraphEnvelope {
  version: number;
  /** Which input produced the graph (provenance only; the graph shape is identical either way). */
  source: GraphSource;
  /** ISO-8601 timestamp of when the export was produced. */
  generatedAt: string;
  graph: OktaGraph;
  /**
   * Optional coverage overlay (slimmed — no per-item `resource`; see `slimCoverage`). Present
   * only when written by `coverage --viz`. Plain JSON-serializable. Absent = no overlay. A full
   * M5 "fat" report is structurally assignable here, so old envelopes still parse.
   */
  coverage?: SlimCoverageReport;
}

/** Wrap a graph in the current versioned envelope. Pure — caller supplies the timestamp. */
export function makeEnvelope(
  graph: OktaGraph,
  source: GraphSource,
  generatedAt: string,
  coverage?: SlimCoverageReport,
): GraphEnvelope {
  const envelope: GraphEnvelope = { version: ENVELOPE_VERSION, source, generatedAt, graph };
  if (coverage) envelope.coverage = coverage;
  return envelope;
}
