/**
 * web/parse-envelope: validate an untrusted JSON blob (a file the user opened) into a
 * GraphEnvelope, with actionable errors. PURE, DOM-free — unit-tested against fixtures.
 *
 * This is the viewer's trust boundary: it must reject foreign/stale files clearly rather
 * than letting a malformed graph blow up deeper in React Flow.
 */

import type { Edge, GraphNode, OktaGraph } from "../../core/model.js";
import { ENVELOPE_VERSION } from "../envelope.js";
import type { GraphEnvelope, GraphSource } from "../envelope.js";

export class EnvelopeError extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Parse + validate. Throws EnvelopeError with a user-facing message on any mismatch. */
export function parseEnvelope(input: unknown): GraphEnvelope {
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

  return {
    version: ENVELOPE_VERSION,
    source,
    generatedAt,
    graph: { nodes: graph.nodes as GraphNode[], edges: graph.edges as Edge[] } satisfies OktaGraph,
  };
}
