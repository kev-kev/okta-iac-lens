/**
 * matchSegments oracle: which runs of a label are lit for a query.
 * Reassembling the segments must always reproduce the original text exactly.
 */

import { describe, expect, it } from "vitest";
import { matchSegments } from "../src/render/web/search-match.js";

const lit = (text: string, query: string): string =>
  matchSegments(text, query)
    .filter((s) => s.hit)
    .map((s) => s.text)
    .join("|");

const rebuild = (text: string, query: string): string =>
  matchSegments(text, query)
    .map((s) => s.text)
    .join("");

describe("matchSegments", () => {
  it("marks the matched run, case-insensitively, preserving original casing", () => {
    const segs = matchSegments("Engineering", "eng");
    expect(segs).toEqual([
      { text: "Eng", hit: true },
      { text: "ineering", hit: false },
    ]);
  });

  it("marks a match in the middle", () => {
    expect(matchSegments("Platform Engineers", "eng")).toEqual([
      { text: "Platform ", hit: false },
      { text: "Eng", hit: true },
      { text: "ineers", hit: false },
    ]);
  });

  it("marks every occurrence", () => {
    expect(lit("Engineering Managers Engaged", "eng")).toBe("Eng|Eng");
  });

  it("returns the whole label unlit when the query is absent (e.g. id-only match)", () => {
    expect(matchSegments("Widgets", "eng")).toEqual([{ text: "Widgets", hit: false }]);
  });

  it("treats an empty / whitespace query as no highlight", () => {
    expect(matchSegments("Engineering", "")).toEqual([{ text: "Engineering", hit: false }]);
    expect(matchSegments("Engineering", "   ")).toEqual([{ text: "Engineering", hit: false }]);
  });

  it("never drops or reorders characters", () => {
    for (const q of ["eng", "e", "ng", "GINE", "xyz", ""]) {
      expect(rebuild("Engineering", q)).toBe("Engineering");
    }
  });
});
