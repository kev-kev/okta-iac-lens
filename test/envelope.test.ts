/**
 * Envelope round-trip + the viewer's trust boundary. `export` writes makeEnvelope(...);
 * the viewer reads parseEnvelope(...). A graph must survive the round-trip unchanged, and
 * foreign/stale JSON must be rejected with a distinct, actionable message.
 */

import { describe, expect, it } from "vitest";
import { ENVELOPE_VERSION, makeEnvelope } from "../src/render/envelope.js";
import { EnvelopeError, parseEnvelope } from "../src/render/web/parse-envelope.js";
import { computeCoverage } from "../src/analysis/coverage.js";
import { graphFromFixture, liveResources, stateResources } from "./fixture.js";

describe("makeEnvelope + parseEnvelope", () => {
  const graph = graphFromFixture();
  const envelope = makeEnvelope(graph, "tfstate", "2026-07-03T00:00:00.000Z");

  it("wraps the graph in the current versioned envelope", () => {
    expect(envelope).toMatchObject({
      version: ENVELOPE_VERSION,
      source: "tfstate",
      generatedAt: "2026-07-03T00:00:00.000Z",
    });
    expect(envelope.graph).toBe(graph);
  });

  it("round-trips the graph unchanged through JSON + parseEnvelope", () => {
    const roundTripped = parseEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(roundTripped.graph).toEqual(graph);
    expect(roundTripped.source).toBe("tfstate");
  });
});

describe("makeEnvelope + parseEnvelope — coverage overlay (M5)", () => {
  const graph = graphFromFixture();
  const report = computeCoverage(liveResources(), stateResources());

  it("round-trips an embedded coverage report", () => {
    const env = makeEnvelope(graph, "okta", "t", report);
    const rt = parseEnvelope(JSON.parse(JSON.stringify(env)));
    expect(rt.coverage).toEqual(report);
    expect(rt.notice).toBeUndefined();
  });

  it("a coverage-less v1 file parses with no coverage and no notice (compat)", () => {
    const rt = parseEnvelope(JSON.parse(JSON.stringify(makeEnvelope(graph, "tfstate", "t"))));
    expect(rt.coverage).toBeUndefined();
    expect(rt.notice).toBeUndefined();
  });

  it("degrades gracefully on a malformed coverage field (decision B): graph renders + notice", () => {
    const bad = { ...makeEnvelope(graph, "okta", "t"), coverage: { bogus: true } };
    const rt = parseEnvelope(bad);
    expect(rt.graph).toEqual(graph);
    expect(rt.coverage).toBeUndefined();
    expect(rt.notice).toMatch(/malformed/i);
  });
});

describe("parseEnvelope rejections", () => {
  it("rejects a non-envelope JSON object", () => {
    expect(() => parseEnvelope({ hello: "world" })).toThrow(EnvelopeError);
    expect(() => parseEnvelope({ hello: "world" })).toThrow(/not an okta-iac-lens export/i);
  });

  it("rejects a future/unsupported version with the version in the message", () => {
    const graph = graphFromFixture();
    const future = { ...makeEnvelope(graph, "tfstate", "t"), version: 2 };
    expect(() => parseEnvelope(future)).toThrow(/version 2/);
  });

  it("rejects an envelope whose graph is missing nodes/edges arrays", () => {
    const bad = { version: ENVELOPE_VERSION, source: "tfstate", generatedAt: "t", graph: { nodes: [] } };
    expect(() => parseEnvelope(bad)).toThrow(/nodes.*edges|edges.*nodes/i);
  });

  it("rejects non-object input", () => {
    expect(() => parseEnvelope("not json")).toThrow(EnvelopeError);
    expect(() => parseEnvelope(null)).toThrow(EnvelopeError);
  });
});
