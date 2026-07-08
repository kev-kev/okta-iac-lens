/**
 * traceUser oracle — one user's access, computed from their group-id membership (a trace INPUT,
 * never a graph node). Membership arrays are synthesized against the same fixture as the M1 trace
 * oracle, so no user PII fixture is needed. Mirrors trace()/traceApp() on:
 *   g-eng = Engineering (populated by eng-rule, session policy Default-MFA, grants GitHub+Datadog;
 *           Datadog under Strict-Auth), g-con = Contractors (no rule, no session policy, GitHub only).
 */

import { describe, expect, it } from "vitest";
import { traceUser, type UserRef } from "../src/core/access-paths.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const alice: UserRef = { id: "u-alice", login: "alice@example.com" };
const names = <T extends { name: string }>(xs: T[]): string[] => xs.map((x) => x.name);

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
});
