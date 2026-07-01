import { describe, expect, it } from "vitest";
import { parseTfState } from "../src/core/parse-tfstate.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import { loadFixtureJson } from "./fixture.js";

type OfKind<K extends ParsedResource["kind"]> = Extract<ParsedResource, { kind: K }>;

function byKind<K extends ParsedResource["kind"]>(
  resources: ParsedResource[],
  kind: K,
): OfKind<K>[] {
  return resources.filter((r): r is OfKind<K> => r.kind === kind);
}

describe("parseTfState", () => {
  const resources = parseTfState(loadFixtureJson());

  it("normalizes each relevant resource type", () => {
    expect(byKind(resources, "Group")).toHaveLength(2);
    expect(byKind(resources, "App")).toHaveLength(2);
    expect(byKind(resources, "GroupRule")).toHaveLength(1);
    expect(byKind(resources, "GlobalSessionPolicy")).toHaveLength(1);
    expect(byKind(resources, "AppAuthPolicy")).toHaveLength(1);
    expect(byKind(resources, "AppGroupAssignment")).toHaveLength(3);
  });

  it("recurses into child_modules (finds the nested app auth policy)", () => {
    const policy = byKind(resources, "AppAuthPolicy")[0];
    expect(policy).toMatchObject({ id: "p-auth", name: "Strict-Auth" });
    expect(policy.address).toContain("module.security");
  });

  it("sources app name from `label`, not the app-type slug", () => {
    const apps = byKind(resources, "App");
    expect(apps.map((a) => a.name).sort()).toEqual(["Datadog", "GitHub"]);
    expect(apps.find((a) => a.id === "a-gh")?.appType).toBe("okta_app_oauth");
  });

  it("carries the app's authentication_policy id; null when absent", () => {
    const apps = byKind(resources, "App");
    expect(apps.find((a) => a.id === "a-gh")?.authenticationPolicyId).toBeNull();
    expect(apps.find((a) => a.id === "a-dd")?.authenticationPolicyId).toBe("p-auth");
  });

  it("stores the group-rule expression literally (never evaluated)", () => {
    const rule = byKind(resources, "GroupRule")[0];
    expect(rule.expression).toBe('user.department=="Engineering"');
    expect(rule.populates).toEqual(["g-eng"]);
  });
});
