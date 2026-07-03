/**
 * derive-cards oracle: the full graph -> "policies as attributes" transformation. Policies
 * leave the flow graph and become maps keyed by the resource they belong to; sharing is
 * preserved in resourcesByPolicy. The two layers stay distinct and org-default stays implicit.
 */

import { describe, expect, it } from "vitest";
import { deriveCards } from "../src/render/web/derive-cards.js";
import { graphFromFixture } from "./fixture.js";

describe("deriveCards", () => {
  const cards = deriveCards(graphFromFixture());

  it("keeps only rule/group/app in the flow graph (no policy nodes or edges)", () => {
    expect(cards.flow.nodes.map((n) => n.id).sort()).toEqual([
      "a-dd",
      "a-gh",
      "g-con",
      "g-eng",
      "gr-eng",
    ]);
    expect([...new Set(cards.flow.edges.map((e) => e.kind))].sort()).toEqual([
      "grants",
      "populates",
    ]);
  });

  it("attaches each group's session policy (and leaves groups without one absent)", () => {
    expect(cards.sessionPolicyByGroup.get("g-eng")?.name).toBe("Default-MFA");
    expect(cards.sessionPolicyByGroup.has("g-con")).toBe(false);
  });

  it("attaches each app's auth policy; an app with none is org default (absent)", () => {
    expect(cards.authPolicyByApp.get("a-dd")?.name).toBe("Strict-Auth");
    expect(cards.authPolicyByApp.has("a-gh")).toBe(false); // org default
  });

  it("records the sharing footprint per policy", () => {
    expect(cards.resourcesByPolicy.get("p-sess")).toEqual(["g-eng"]);
    expect(cards.resourcesByPolicy.get("p-auth")).toEqual(["a-dd"]);
  });
});
