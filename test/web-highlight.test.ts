/**
 * Highlight oracle. The highlight set for a traced group must be exactly the group, its
 * apps, its session policy, and each app's non-default auth policy — plus exactly the edges
 * between them. Built on the imported core `trace()`, so it can't drift from CLI semantics.
 */

import { describe, expect, it } from "vitest";
import { trace } from "../src/core/access-paths.js";
import { highlightForTrace } from "../src/render/web/highlight.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const sorted = (s: Set<string>): string[] => [...s].sort();

describe("highlightForTrace — Engineering", () => {
  const h = highlightForTrace(trace(graph, "Engineering"));

  it("highlights the group, both apps, the session policy, and Datadog's auth policy", () => {
    expect(sorted(h.nodeIds)).toEqual(["a-dd", "a-gh", "g-eng", "p-auth", "p-sess"]);
  });

  it("highlights exactly the connecting edges — and NO protects edge for org-default GitHub", () => {
    expect(sorted(h.edgeIds)).toEqual([
      "appliesTo:p-sess:g-eng",
      "grants:g-eng:a-dd",
      "grants:g-eng:a-gh",
      "protects:p-auth:a-dd",
    ]);
    expect(h.edgeIds.has("protects:p-auth:a-gh")).toBe(false);
  });
});

describe("highlightForTrace — Contractors", () => {
  const h = highlightForTrace(trace(graph, "Contractors"));

  it("highlights only Contractors and GitHub (no policy nodes)", () => {
    expect(sorted(h.nodeIds)).toEqual(["a-gh", "g-con"]);
  });

  it("highlights only the single grants edge", () => {
    expect(sorted(h.edgeIds)).toEqual(["grants:g-con:a-gh"]);
  });
});
