/**
 * slimCoverage oracle: drops per-item `resource` for the envelope; everything the viewer reads
 * survives, and a full report stays structurally usable everywhere the slim shape is expected.
 */

import { describe, expect, it } from "vitest";
import { computeCoverage, slimCoverage } from "../src/analysis/coverage.js";
import { recommend } from "../src/analysis/recommendations.js";
import { liveResources, stateResources } from "./fixture.js";

const report = computeCoverage(liveResources(), stateResources());

describe("slimCoverage", () => {
  const slim = slimCoverage(report);

  it("drops `resource` from every item but keeps the display fields", () => {
    expect(slim.items).toHaveLength(report.items.length);
    for (const item of slim.items) {
      expect(item).not.toHaveProperty("resource");
      expect(item.kind).toBeDefined();
      expect(item.key).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.bucket).toBeDefined();
    }
  });

  it("preserves overall + perKind unchanged", () => {
    expect(slim.overall).toEqual(report.overall);
    expect(slim.perKind).toEqual(report.perKind);
  });

  it("recommend() gives identical guidance from slim or full (single source of truth)", () => {
    expect(recommend(slim)).toEqual(recommend(report));
  });

  it("is smaller than the full report on the wire", () => {
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(report).length);
  });
});
