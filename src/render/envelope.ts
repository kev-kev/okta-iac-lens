/**
 * render/envelope: the on-disk interchange format between `export` (CLI writer) and the
 * web viewer (reader). One source of truth for the shape + version so both sides agree.
 *
 * The `graph` value is the UNTRANSFORMED `OktaGraph` (already plain arrays — see model.ts).
 * `makeEnvelope` is pure (the timestamp is passed in, not read here) so it stays testable;
 * the CLI supplies `new Date().toISOString()` at call time.
 */

import type { OktaGraph } from "../core/model.js";
import type { AppAuthPolicyRule } from "../core/parse-tfstate.js";
import type { SlimCoverageReport } from "../analysis/coverage.js";

/**
 * Envelope version. Only bump for INCOMPATIBLE changes.
 *
 * Additive changes DON'T bump: a viewer that ignores an added field still renders the graph.
 *  - M5: the optional `coverage` overlay.
 *  - M12: optional `status`/`priority` node fields (App/GroupRule/GlobalSessionPolicy/AppAuthPolicy)
 *    — the viewer reads neither yet, so a v1 file stays valid and a v1 viewer renders a v2 graph.
 *    (M11's synthesis PENCILLED a bump here; the widening turned out additive, exactly like M5,
 *    so it's held at 1.)
 *  - M15 (2026-07-21, Phase D DECISION): optional `policyRules` — the captured app-auth policy
 *    RULES (never graph nodes) the viewer recomputes strength bands from. Additive, exactly like
 *    M5/M12: a viewer that ignores it renders the graph; an old envelope without it stays valid.
 *    The band could NOT ride as a node field — the org-default policy (the strength kicker's
 *    subject) has no node — so rules travel at envelope level and the viewer bands them through the
 *    SAME pure `strengthResolver` the CLI uses (zero drift). Held at 1. Bump only when a future
 *    change is truly breaking (a required-field change, or a removed/renamed field).
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
  /**
   * Optional app-auth policy RULES (M15 Phase D). Present when the producer captured rules (every
   * live/tfstate export does; the synthetic scale generator does not). The viewer feeds these to
   * the pure `strengthResolver` to band policies + emit grounded strength verdicts — the org
   * default included, which has no node. Absent = the viewer keeps the M13 priors verbatim.
   */
  policyRules?: AppAuthPolicyRule[];
}

/** Wrap a graph in the current versioned envelope. Pure — caller supplies the timestamp. */
export function makeEnvelope(
  graph: OktaGraph,
  source: GraphSource,
  generatedAt: string,
  coverage?: SlimCoverageReport,
  policyRules?: AppAuthPolicyRule[],
): GraphEnvelope {
  const envelope: GraphEnvelope = { version: ENVELOPE_VERSION, source, generatedAt, graph };
  if (coverage) envelope.coverage = coverage;
  // Attach only a non-empty rule set — an empty array is noise (and lets the viewer treat
  // "absent" and "no rules captured" identically: priors stand).
  if (policyRules && policyRules.length > 0) envelope.policyRules = policyRules;
  return envelope;
}
