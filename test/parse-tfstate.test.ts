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

describe("parseTfState — plural okta_app_group_assignments", () => {
  const stateWith = (values: Record<string, unknown>): unknown => ({
    values: {
      root_module: {
        resources: [
          {
            address: "okta_app_group_assignments.x",
            mode: "managed",
            type: "okta_app_group_assignments",
            name: "x",
            values,
          },
        ],
      },
    },
  });

  it("emits one AppGroupAssignment per group block (state-side analogue of the live all-groups read)", () => {
    const state = stateWith({
      app_id: "a-gh",
      group: [
        { id: "g-eng", priority: 0 },
        { id: "g-con", priority: 1, profile: "{}" },
      ],
    });
    const assignments = byKind(parseTfState(state), "AppGroupAssignment");
    expect(assignments.map((a) => `${a.appId}/${a.groupId}`).sort()).toEqual([
      "a-gh/g-con",
      "a-gh/g-eng",
    ]);
  });

  it("ignores a plural resource with no group blocks", () => {
    expect(byKind(parseTfState(stateWith({ app_id: "a-x" })), "AppGroupAssignment")).toHaveLength(0);
  });

  it("flags every plural-sourced pair with viaPluralResource (the absorbs-drift provenance)", () => {
    const state = stateWith({ app_id: "a-gh", group: [{ id: "g-eng" }, { id: "g-con" }] });
    const assignments = byKind(parseTfState(state), "AppGroupAssignment");
    expect(assignments).toHaveLength(2);
    expect(assignments.every((a) => a.viaPluralResource === true)).toBe(true);
  });

  it("does NOT flag pairs from the singular okta_app_group_assignment resource", () => {
    const state = {
      values: {
        root_module: {
          resources: [
            {
              address: "okta_app_group_assignment.x",
              mode: "managed",
              type: "okta_app_group_assignment",
              name: "x",
              values: { id: "a-gh/g-eng", app_id: "a-gh", group_id: "g-eng" },
            },
          ],
        },
      },
    };
    const [assignment] = byKind(parseTfState(state), "AppGroupAssignment");
    expect(assignment.viaPluralResource).toBeUndefined();
  });
});

// --- M12: make the graph true (allowlist, new kinds, status/priority) ---

/** Build a minimal state from a list of {type, values} managed resources. */
function stateOf(resources: { type: string; values: Record<string, unknown> }[]): unknown {
  return {
    values: {
      root_module: {
        resources: resources.map((r, i) => ({
          address: `${r.type}.r${i}`,
          mode: "managed",
          type: r.type,
          name: `r${i}`,
          values: r.values,
        })),
      },
    },
  };
}

describe("parseTfState — M12 app-type allowlist", () => {
  // The 9 NON-APP `okta_app_*` lookalikes (M11 fact table) that a narrow denylist let through.
  const LOOKALIKES = [
    "okta_app_oauth_api_scope",
    "okta_app_oauth_post_logout_redirect_uri",
    "okta_app_oauth_redirect_uri",
    "okta_app_oauth_role_assignment",
    "okta_app_saml_app_settings",
    "okta_app_user_base_schema_property",
    "okta_app_user_schema_property",
  ];

  it("does NOT turn okta_app_* lookalikes into App nodes", () => {
    const state = stateOf(LOOKALIKES.map((type) => ({ type, values: { id: `x-${type}` } })));
    expect(byKind(parseTfState(state), "App")).toHaveLength(0);
  });

  it("still parses every real okta_app_* application type", () => {
    const APP_TYPES = [
      "okta_app_auto_login",
      "okta_app_basic_auth",
      "okta_app_bookmark",
      "okta_app_oauth",
      "okta_app_saml",
      "okta_app_secure_password_store",
      "okta_app_shared_credentials",
      "okta_app_swa",
      "okta_app_three_field",
    ];
    const state = stateOf(APP_TYPES.map((type) => ({ type, values: { id: `a-${type}`, label: type } })));
    expect(byKind(parseTfState(state), "App")).toHaveLength(APP_TYPES.length);
  });
});

describe("parseTfState — M12 individual + access-policy assignments", () => {
  it("captures okta_app_user as an AppUserAssignment (not an App), reading user_id", () => {
    const state = stateOf([
      { type: "okta_app_user", values: { id: "u1", app_id: "a-sf", user_id: "u1" } },
    ]);
    const res = parseTfState(state);
    expect(byKind(res, "App")).toHaveLength(0);
    expect(byKind(res, "AppUserAssignment")).toEqual([
      { kind: "AppUserAssignment", address: "okta_app_user.r0", appId: "a-sf", userId: "u1" },
    ]);
  });

  it("captures okta_app_access_policy_assignment as an AppAccessPolicyAssignment", () => {
    const state = stateOf([
      {
        type: "okta_app_access_policy_assignment",
        values: { id: "a-gh", app_id: "a-gh", policy_id: "p-auth" },
      },
    ]);
    expect(byKind(parseTfState(state), "AppAccessPolicyAssignment")).toEqual([
      {
        kind: "AppAccessPolicyAssignment",
        address: "okta_app_access_policy_assignment.r0",
        appId: "a-gh",
        policyId: "p-auth",
      },
    ]);
  });
});

describe("parseTfState — M12 status + priority", () => {
  it("carries status on apps and rules, priority+status on session policies", () => {
    const state = stateOf([
      { type: "okta_app_oauth", values: { id: "a", label: "A", status: "INACTIVE" } },
      { type: "okta_group_rule", values: { id: "gr", name: "gr", status: "INACTIVE" } },
      {
        type: "okta_policy_signon",
        values: { id: "p", name: "P", priority: 2, status: "ACTIVE" },
      },
    ]);
    const res = parseTfState(state);
    expect(byKind(res, "App")[0].status).toBe("INACTIVE");
    expect(byKind(res, "GroupRule")[0].status).toBe("INACTIVE");
    expect(byKind(res, "GlobalSessionPolicy")[0]).toMatchObject({ priority: 2, status: "ACTIVE" });
  });

  it("leaves status/priority undefined when absent (idealized fixtures => ACTIVE by default)", () => {
    const state = stateOf([{ type: "okta_app_oauth", values: { id: "a", label: "A" } }]);
    expect(byKind(parseTfState(state), "App")[0].status).toBeUndefined();
  });
});

// --- M15: app auth policy RULES (okta_app_signon_policy_rule) ---

describe("parseTfState — M15 app auth policy rules", () => {
  it("parses a 1FA ALLOW rule, decoding the jsonencode'd knowledge constraint", () => {
    const state = stateOf([
      {
        type: "okta_app_signon_policy_rule",
        values: {
          id: "rul-1fa",
          policy_id: "p-strict",
          name: "Contractors-Password-Bypass",
          access: "ALLOW",
          status: "ACTIVE",
          system: false,
          priority: 2,
          type: "ASSURANCE",
          factor_mode: "1FA",
          re_authentication_frequency: "PT0S",
          network_connection: "ANYWHERE",
          groups_included: ["g-con"],
          constraints: ['{"knowledge":{"types":["password"],"required":false}}'],
        },
      },
    ]);
    expect(byKind(parseTfState(state), "AppAuthPolicyRule")).toEqual([
      {
        kind: "AppAuthPolicyRule",
        id: "rul-1fa",
        policyId: "p-strict",
        name: "Contractors-Password-Bypass",
        address: "okta_app_signon_policy_rule.r0",
        priority: 2,
        status: "ACTIVE",
        access: "ALLOW",
        factorMode: "1FA",
        assuranceType: "ASSURANCE",
        reauthenticateIn: "PT0S",
        constraints: [{ knowledge: { required: false, types: ["password"] } }],
        groupsIncluded: ["g-con"],
        networkConnection: "ANYWHERE",
      },
    ]);
  });

  it("decodes a possession constraint (phishing-resistant / hardware-protection REQUIRED)", () => {
    const state = stateOf([
      {
        type: "okta_app_signon_policy_rule",
        values: {
          id: "rul-pr2fa",
          policy_id: "p-strict",
          name: "Require-Phishing-Resistant",
          access: "ALLOW",
          factor_mode: "2FA",
          constraints: [
            '{"possession":{"required":false,"deviceBound":"REQUIRED","hardwareProtection":"REQUIRED","phishingResistant":"REQUIRED"}}',
          ],
        },
      },
    ]);
    const [rule] = byKind(parseTfState(state), "AppAuthPolicyRule");
    expect(rule.constraints).toEqual([
      {
        possession: {
          required: false,
          deviceBound: "REQUIRED",
          hardwareProtection: "REQUIRED",
          phishingResistant: "REQUIRED",
        },
      },
    ]);
  });

  it("captures a DENY rule with no factor mode (factorMode stays undefined, never guessed)", () => {
    const state = stateOf([
      {
        type: "okta_app_signon_policy_rule",
        values: { id: "rul-deny", policy_id: "p-strict", name: "Block", access: "DENY" },
      },
    ]);
    const [rule] = byKind(parseTfState(state), "AppAuthPolicyRule");
    expect(rule.access).toBe("DENY");
    expect(rule.factorMode).toBeUndefined();
    expect(rule.constraints).toEqual([]);
  });

  it("carries INACTIVE status (the strength model excludes it — M12 rule)", () => {
    const state = stateOf([
      {
        type: "okta_app_signon_policy_rule",
        values: { id: "rul-off", policy_id: "p-strict", name: "Old", access: "ALLOW", status: "INACTIVE" },
      },
    ]);
    expect(byKind(parseTfState(state), "AppAuthPolicyRule")[0].status).toBe("INACTIVE");
  });

  it("skips an unparseable constraint string rather than crashing", () => {
    const state = stateOf([
      {
        type: "okta_app_signon_policy_rule",
        values: {
          id: "rul-bad",
          policy_id: "p-strict",
          name: "Weird",
          access: "ALLOW",
          factor_mode: "2FA",
          constraints: ["{not valid json", '{"possession":{"phishingResistant":"REQUIRED"}}'],
        },
      },
    ]);
    const [rule] = byKind(parseTfState(state), "AppAuthPolicyRule");
    // The malformed element is dropped; the valid one survives.
    expect(rule.constraints).toEqual([{ possession: { phishingResistant: "REQUIRED" } }]);
  });
});
