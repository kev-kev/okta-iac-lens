/**
 * traceApp oracle — the reverse of trace(). Mirrors the M1 trace oracle on the same fixture:
 * who reaches an app, via which rules, under which auth policy.
 */

import { describe, expect, it } from "vitest";
import { traceApp } from "../src/core/access-paths.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const names = <T extends { name: string }>(xs: T[]): string[] => xs.map((x) => x.name).sort();

describe("traceApp", () => {
  it("GitHub: reached by Engineering + Contractors, via eng-rule, org-default policy", () => {
    const r = traceApp(graph, "GitHub");
    expect(names(r.grantingGroups)).toEqual(["Contractors", "Engineering"]);
    expect(names(r.populatingRules)).toEqual(["eng-rule"]); // populates Engineering
    expect(r.authPolicy).toBeNull(); // org default
  });

  it("Datadog: reached by Engineering only, under Strict-Auth", () => {
    const r = traceApp(graph, "Datadog");
    expect(names(r.grantingGroups)).toEqual(["Engineering"]);
    expect(r.authPolicy?.name).toBe("Strict-Auth");
  });

  it("matches by id as well as name", () => {
    expect(traceApp(graph, "a-gh").app.name).toBe("GitHub");
  });

  it("throws on an unknown app", () => {
    expect(() => traceApp(graph, "nope")).toThrow(/App not found/);
  });
});
