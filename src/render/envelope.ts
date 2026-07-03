/**
 * render/envelope: the on-disk interchange format between `export` (CLI writer) and the
 * web viewer (reader). One source of truth for the shape + version so both sides agree.
 *
 * The `graph` value is the UNTRANSFORMED `OktaGraph` (already plain arrays — see model.ts).
 * `makeEnvelope` is pure (the timestamp is passed in, not read here) so it stays testable;
 * the CLI supplies `new Date().toISOString()` at call time.
 */

import type { OktaGraph } from "../core/model.js";

/** Bump when the envelope shape changes incompatibly; the viewer rejects mismatches. */
export const ENVELOPE_VERSION = 1;

export type GraphSource = "tfstate" | "okta";

export interface GraphEnvelope {
  version: number;
  /** Which input produced the graph (provenance only; the graph shape is identical either way). */
  source: GraphSource;
  /** ISO-8601 timestamp of when the export was produced. */
  generatedAt: string;
  graph: OktaGraph;
}

/** Wrap a graph in the current versioned envelope. Pure — caller supplies the timestamp. */
export function makeEnvelope(
  graph: OktaGraph,
  source: GraphSource,
  generatedAt: string,
): GraphEnvelope {
  return { version: ENVELOPE_VERSION, source, generatedAt, graph };
}
