/**
 * CLI-layer user trace: the live loader's credential/mapping paths and the text/JSON renderers.
 * The full live command is exercised in Phase B (needs a tenant + a known test user); here we
 * test everything reachable offline. Membership is synthesized against the fixture — no PII.
 */

import { describe, expect, it } from "vitest";
import { explainUserApp, traceUser, type UserRef } from "../src/core/access-paths.js";
import { loadUserMembership } from "../src/inputs/load-resources.js";
import type { OktaUserReader } from "../src/inputs/okta-api.js";
import { renderUserAppExplain, renderUserTrace } from "../src/render/cli.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const alice: UserRef = { id: "u-alice", login: "alice@example.com" };
const engTrace = traceUser(graph, { user: alice, groupIds: ["g-eng"] });

describe("loadUserMembership", () => {
  it("rejects with an actionable error before any network call when credentials are absent", async () => {
    await expect(loadUserMembership("alice@example.com", undefined, {})).rejects.toThrow(
      /OKTA_ORG_URL and OKTA_API_TOKEN/,
    );
  });

  it("resolves login -> user + group ids via an injected reader (login from profile)", async () => {
    const reader: OktaUserReader = {
      getUserByLogin: async (login) => ({ id: "u-alice", profile: { login } }),
      listUserGroupIds: async (id) => (id === "u-alice" ? ["g-eng", "g-con"] : []),
    };
    const membership = await loadUserMembership("alice@example.com", reader, {});
    expect(membership).toEqual({
      user: { id: "u-alice", login: "alice@example.com" },
      groupIds: ["g-eng", "g-con"],
    });
  });
});

describe("renderUserTrace", () => {
  it("text: apps with gates, group provenance, and the runtime caveat", () => {
    const text = renderUserTrace(engTrace, "text");
    expect(text).toContain("User: alice@example.com (u-alice)");
    expect(text).toContain("Apps provisioned (2):");
    expect(text).toContain("- Datadog (a-dd)  ·  via: Engineering  ·  app gate: Strict-Auth (p-auth)");
    expect(text).toContain("app gate: — org default app sign-on policy"); // GitHub, not "unprotected"
    expect(text).toContain("populated by rule eng-rule (`user.department==\"Engineering\"`)");
    expect(text).toContain("session gate: Default-MFA (p-sess)");
    expect(text).toMatch(/runtime policy conditions .* are not evaluated/);
  });

  it("text: a direct (rule-less) membership reads as such, and no session policy shows (none)", () => {
    const text = renderUserTrace(traceUser(graph, { user: alice, groupIds: ["g-con"] }), "text");
    expect(text).toContain("direct or app-push membership");
    expect(text).toContain("session gate: (none)");
  });

  it("text: surfaces a count for membership groups outside the loaded scope", () => {
    const text = renderUserTrace(traceUser(graph, { user: alice, groupIds: ["g-eng", "g-x"] }), "text");
    expect(text).toContain("1 membership group(s) outside the loaded Terraform/live scope");
  });

  it("json: round-trips the result", () => {
    const parsed = JSON.parse(renderUserTrace(engTrace, "json"));
    expect(parsed.user.login).toBe("alice@example.com");
    expect(parsed.apps.map((a: { name: string }) => a.name)).toEqual(["Datadog", "GitHub"]);
  });
});

describe("renderUserAppExplain", () => {
  it("positive: PROVISIONED with the path and app gate", () => {
    const text = renderUserAppExplain(explainUserApp(graph, engTrace, "Datadog"), "text");
    expect(text).toContain("App: Datadog (a-dd)");
    expect(text).toContain("Result: PROVISIONED");
    expect(text).toContain("via Engineering (g-eng)");
    expect(text).toContain("App gate: Strict-Auth (p-auth)");
  });

  it("negative: NOT PROVISIONED explains the would-be groups + verbatim, unevaluated rules", () => {
    // A user only in Contractors does NOT reach Datadog (granted only via Engineering).
    const conTrace = traceUser(graph, { user: alice, groupIds: ["g-con"] });
    const text = renderUserAppExplain(explainUserApp(graph, conTrace, "Datadog"), "text");
    expect(text).toContain("Result: NOT PROVISIONED");
    expect(text).toContain("Granted by groups (1):");
    expect(text).toContain("- Engineering (g-eng)");
    expect(text).toMatch(/expressions shown verbatim, NOT evaluated/);
    expect(text).toContain('eng-rule (gr-eng): `user.department=="Engineering"`');
  });

  it("throws on an unknown app", () => {
    expect(() => explainUserApp(graph, engTrace, "nope")).toThrow(/App not found/);
  });
});
