/**
 * web/parse-envelope: validate an untrusted JSON blob (a file the user opened) into a
 * GraphEnvelope, with actionable errors. PURE, DOM-free — unit-tested against fixtures.
 *
 * This is the viewer's trust boundary. Required fields (version, graph) reject on mismatch. The
 * OPTIONAL `coverage` overlay degrades gracefully (decision B): a malformed coverage field is
 * dropped and reported via `notice` — the graph still renders — rather than failing the file.
 */

import type { Edge, GraphNode, OktaGraph } from "../../core/model.js";
import type { AppAuthPolicyRule } from "../../core/parse-tfstate.js";
import type { SlimCoverageReport } from "../../analysis/coverage.js";
import { ENVELOPE_VERSION } from "../envelope.js";
import type { GraphEnvelope, GraphSource } from "../envelope.js";

export class EnvelopeError extends Error {}

/** Parse result: the validated envelope, plus a non-fatal `notice` (e.g. dropped overlay). */
export interface ParsedEnvelope extends GraphEnvelope {
  notice?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Lenient structural check — enough to know the overlay is usable, not a full schema. */
function looksLikeCoverage(v: unknown): v is SlimCoverageReport {
  return (
    isObject(v) &&
    Array.isArray(v.perKind) &&
    Array.isArray(v.items) &&
    isObject(v.overall)
  );
}

/**
 * Lenient structural check for the M15 `policyRules` carrier — enough for the strength model to run
 * (it is itself defensive about field contents). Every element must be a rule-tagged object with the
 * string keys the resolver groups + classifies on and a `constraints` array. A malformed carrier is
 * dropped (not fatal): strength verdicts simply fall back to the M13 priors.
 */
function looksLikePolicyRules(v: unknown): v is AppAuthPolicyRule[] {
  return (
    Array.isArray(v) &&
    v.every(
      (r) =>
        isObject(r) &&
        r.kind === "AppAuthPolicyRule" &&
        typeof r.id === "string" &&
        typeof r.policyId === "string" &&
        typeof r.access === "string" &&
        Array.isArray(r.constraints),
    )
  );
}

/** Parse + validate. Throws EnvelopeError only for required-field problems. */
export function parseEnvelope(input: unknown): ParsedEnvelope {
  if (!isObject(input) || !("version" in input) || !("graph" in input)) {
    throw new EnvelopeError("Not an okta-iac-lens export (expected an export envelope).");
  }

  const version = input.version;
  if (version !== ENVELOPE_VERSION) {
    throw new EnvelopeError(
      `Unsupported export version ${String(version)}; this viewer supports version ${ENVELOPE_VERSION}. Re-run \`export\` with the current CLI.`,
    );
  }

  const graph = input.graph;
  if (!isObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new EnvelopeError("Malformed export: `graph` must have `nodes` and `edges` arrays.");
  }

  const source: GraphSource = input.source === "okta" ? "okta" : "tfstate";
  const generatedAt = typeof input.generatedAt === "string" ? input.generatedAt : "";

  // Optional overlays: each is valid -> keep; present-but-malformed -> drop + notice; absent ->
  // nothing. A bad overlay never fails the file — the graph always renders.
  const notices: string[] = [];

  let coverage: SlimCoverageReport | undefined;
  if ("coverage" in input && input.coverage !== undefined) {
    if (looksLikeCoverage(input.coverage)) {
      coverage = input.coverage;
    } else {
      notices.push(
        "This export's coverage data was malformed and has been ignored; showing the graph without the coverage overlay.",
      );
    }
  }

  let policyRules: AppAuthPolicyRule[] | undefined;
  if ("policyRules" in input && input.policyRules !== undefined) {
    if (looksLikePolicyRules(input.policyRules)) {
      policyRules = input.policyRules;
    } else {
      notices.push(
        "This export's policy-rule data was malformed and has been ignored; showing the graph without rule-based strength verdicts.",
      );
    }
  }

  const parsed: ParsedEnvelope = {
    version: ENVELOPE_VERSION,
    source,
    generatedAt,
    graph: { nodes: graph.nodes as GraphNode[], edges: graph.edges as Edge[] } satisfies OktaGraph,
  };
  if (coverage) parsed.coverage = coverage;
  if (policyRules) parsed.policyRules = policyRules;
  if (notices.length > 0) parsed.notice = notices.join(" ");
  return parsed;
}
