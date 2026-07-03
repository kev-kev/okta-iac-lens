/**
 * Highlight oracle. Two modes: a traced group (group + its apps + grants edges), and a
 * selected policy (every resource it governs). Policies are attributes now, so no policy nodes
 * appear in any highlight set.
 */

import { describe, expect, it } from "vitest";
import { trace } from "../src/core/access-paths.js";
import { deriveCards } from "../src/render/web/derive-cards.js";
import { highlightForPolicy, highlightForTrace } from "../src/render/web/highlight.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const cards = deriveCards(graph);
const sorted = (s: Set<string>): string[] => [...s].sort();

describe("highlightForTrace", () => {
  it("Engineering: the group, both apps, and the grants edges (no policy nodes)", () => {
    const h = highlightForTrace(trace(graph, "Engineering"));
    expect(sorted(h.nodeIds)).toEqual(["a-dd", "a-gh", "g-eng"]);
    expect(sorted(h.edgeIds)).toEqual(["grants:g-eng:a-dd", "grants:g-eng:a-gh"]);
  });

  it("Contractors: only Contractors and GitHub", () => {
    const h = highlightForTrace(trace(graph, "Contractors"));
    expect(sorted(h.nodeIds)).toEqual(["a-gh", "g-con"]);
    expect(sorted(h.edgeIds)).toEqual(["grants:g-con:a-gh"]);
  });
});

describe("highlightForPolicy (sharing)", () => {
  it("an app auth policy highlights the apps it protects", () => {
    const h = highlightForPolicy(cards, "p-auth"); // Strict-Auth -> Datadog
    expect(sorted(h.nodeIds)).toEqual(["a-dd"]);
    expect(h.edgeIds.size).toBe(0);
  });

  it("a session policy highlights the groups it applies to", () => {
    const h = highlightForPolicy(cards, "p-sess"); // Default-MFA -> Engineering
    expect(sorted(h.nodeIds)).toEqual(["g-eng"]);
  });

  it("an unknown policy id highlights nothing", () => {
    expect(highlightForPolicy(cards, "nope").nodeIds.size).toBe(0);
  });
});
