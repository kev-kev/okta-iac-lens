/**
 * traceUser oracle — one user's access, computed from their group-id membership (a trace INPUT,
 * never a graph node). Membership arrays are synthesized against the same fixture as the M1 trace
 * oracle, so no user PII fixture is needed. Mirrors trace()/traceApp() on:
 *   g-eng = Engineering (populated by eng-rule, session policy Default-MFA, grants GitHub+Datadog;
 *           Datadog under Strict-Auth), g-con = Contractors (no rule, no session policy, GitHub only).
 */

import { describe, expect, it } from "vitest";
import { traceUser, type UserRef } from "../src/core/access-paths.js";
import type { AppNode } from "../src/core/model.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const alice: UserRef = { id: "u-alice", login: "alice@example.com" };
const names = <T extends { name: string }>(xs: T[]): string[] => xs.map((x) => x.name);

/** Pull a real AppNode out of the fixture graph by name (individual-assignment inputs are AppNodes). */
const appByName = (name: string): AppNode => {
  const app = graph.nodes.find((n): n is AppNode => n.kind === "App" && n.name === name);
  if (!app) throw new Error(`fixture has no app "${name}"`);
  return app;
};

describe("traceUser", () => {
  it("member of Engineering: GitHub + Datadog; Datadog under Strict-Auth; via eng-rule; Default-MFA", () => {
    const r = traceUser(graph, { user: alice, groupIds: ["g-eng"] });

    expect(r.user).toEqual(alice);
    expect(names(r.apps)).toEqual(["Datadog", "GitHub"]); // union, name order
    expect(r.appAuthPolicies["a-gh"]).toBeNull(); // org default, NOT unprotected
    expect(r.appAuthPolicies["a-dd"]?.name).toBe("Strict-Auth");
    expect(r.unknownGroupIds).toEqual([]);

    expect(r.viaGroups).toHaveLength(1);
    const eng = r.viaGroups[0];
    expect(eng.group.name).toBe("Engineering");
    expect(names(eng.apps)).toEqual(["GitHub", "Datadog"]); // per-group: grant order
    expect(names(eng.populatingRules)).toEqual(["eng-rule"]);
    expect(eng.globalSessionPolicy?.name).toBe("Default-MFA");
  });

  it("member of Contractors only: GitHub only; direct (no populating rule); no session policy", () => {
    const r = traceUser(graph, { user: alice, groupIds: ["g-con"] });

    expect(names(r.apps)).toEqual(["GitHub"]);
    expect(r.appAuthPolicies["a-gh"]).toBeNull();

    expect(r.viaGroups).toHaveLength(1);
    const con = r.viaGroups[0];
    expect(con.group.name).toBe("Contractors");
    expect(con.populatingRules).toEqual([]); // direct / app-push, not rule-populated
    expect(con.globalSessionPolicy).toBeNull();
  });

  it("member of both groups: GitHub deduped to a single app across groups", () => {
    const r = traceUser(graph, { user: alice, groupIds: ["g-eng", "g-con"] });

    expect(names(r.apps)).toEqual(["Datadog", "GitHub"]); // GitHub once, not twice
    expect(r.viaGroups.map((v) => v.group.name)).toEqual(["Engineering", "Contractors"]); // input order
  });

  it("surfaces membership groups absent from the graph instead of dropping them silently", () => {
    const r = traceUser(graph, { user: alice, groupIds: ["g-eng", "g-nope"] });

    expect(r.unknownGroupIds).toEqual(["g-nope"]);
    expect(r.viaGroups.map((v) => v.group.name)).toEqual(["Engineering"]);
    expect(names(r.apps)).toEqual(["Datadog", "GitHub"]); // known-group access unaffected
  });

  it("empty membership: no apps, no groups, nothing unknown", () => {
    const r = traceUser(graph, { user: alice, groupIds: [] });
    expect(r.apps).toEqual([]);
    expect(r.viaGroups).toEqual([]);
    expect(r.unknownGroupIds).toEqual([]);
  });

  it("no directApps (default): individualApps is empty and behavior is unchanged", () => {
    const r = traceUser(graph, { user: alice, groupIds: ["g-eng"] });
    expect(r.individualApps).toEqual([]);
    expect(names(r.apps)).toEqual(["Datadog", "GitHub"]); // group-only union, as before
  });

  it("folds an individually-assigned app into the union and surfaces it separately, with its auth gate", () => {
    // Contractors grants GitHub only; Datadog is reached SOLELY by individual assignment.
    const r = traceUser(
      graph,
      { user: alice, groupIds: ["g-con"] },
      { directApps: [appByName("Datadog")] },
    );

    expect(names(r.apps)).toEqual(["Datadog", "GitHub"]); // union, name order
    expect(names(r.individualApps)).toEqual(["Datadog"]); // the individual-only channel
    expect(r.appAuthPolicies["a-dd"]?.name).toBe("Strict-Auth"); // gate resolved for the individual app
    expect(r.appAuthPolicies["a-gh"]).toBeNull(); // GitHub still org default

    // Provenance stays honest: individual apps have no granting group, so viaGroups is untouched.
    expect(r.viaGroups).toHaveLength(1);
    expect(r.viaGroups[0].group.name).toBe("Contractors");
    expect(names(r.viaGroups[0].apps)).toEqual(["GitHub"]);
  });

  it("an individually-assigned app already group-reached is deduped and NOT counted as individual", () => {
    // GitHub is granted by Contractors AND passed as a direct assignment — it's group-reached,
    // so it stays a single app and does not appear in the individual-only channel.
    const r = traceUser(
      graph,
      { user: alice, groupIds: ["g-con"] },
      { directApps: [appByName("GitHub")] },
    );

    expect(names(r.apps)).toEqual(["GitHub"]); // no duplicate
    expect(r.individualApps).toEqual([]); // group-reached wins over "individual"
  });
});
