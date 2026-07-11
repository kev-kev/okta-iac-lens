/** M12: the `summary` render surfaces the individual-assignment notice + the org-default wording. */

import { describe, expect, it } from "vitest";
import { renderSummary } from "../src/render/cli.js";
import type { GraphSummary } from "../src/core/access-paths.js";

const summary: GraphSummary = {
  groups: 2,
  apps: 5,
  groupRules: 2,
  globalSessionPolicies: 2,
  appAuthPolicies: 1,
};

describe("renderSummary — individual-assignment notice (M12)", () => {
  it("surfaces okta_app_user count as present-but-not-modeled when > 0", () => {
    const text = renderSummary(summary, "text", 1);
    expect(text).toContain("Individual assignments:  1");
    expect(text).toMatch(/okta_app_user/);
    expect(text).toMatch(/not modeled/i);
  });

  it("omits the line when the count is 0", () => {
    expect(renderSummary(summary, "text", 0)).not.toMatch(/Individual assignments/);
  });

  it("omits the line entirely when no count is provided (back-compat)", () => {
    expect(renderSummary(summary, "text")).not.toMatch(/Individual assignments/);
  });

  it("includes the count in JSON only when provided", () => {
    expect(JSON.parse(renderSummary(summary, "json", 3))).toMatchObject({
      apps: 5,
      individualAssignments: 3,
    });
    expect(JSON.parse(renderSummary(summary, "json"))).not.toHaveProperty("individualAssignments");
  });
});
