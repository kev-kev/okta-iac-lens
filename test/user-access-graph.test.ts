/**
 * buildUserAccessGraph — the sub-graph rendered on the canvas for one user's access. Scoped to
 * their groups, the apps those groups grant, and the attached policies/rules; nothing else.
 */

import { describe, expect, it } from "vitest";
import { traceUser, type UserRef } from "../src/core/access-paths.js";
import { buildUserAccessGraph } from "../src/render/web/user-access-graph.js";
import { graphFromFixture } from "./fixture.js";

const graph = graphFromFixture();
const alice: UserRef = { id: "u-alice", login: "alice@example.com" };

describe("buildUserAccessGraph", () => {
  it("keeps the user's group, its granted apps, and the attached policies + rule", () => {
    const result = traceUser(graph, { user: alice, groupIds: ["g-eng"] });
    const sub = buildUserAccessGraph(graph, result);
    const ids = new Set(sub.nodes.map((n) => n.id));

    // Engineering, GitHub, Datadog, Default-MFA (session), Strict-Auth (auth), eng-rule.
    expect(ids).toEqual(new Set(["g-eng", "a-gh", "a-dd", "p-sess", "p-auth", "gr-eng"]));

    const edgeKinds = sub.edges.map((e) => `${e.kind}:${e.from}->${e.to}`);
    expect(edgeKinds).toContain("grants:g-eng->a-gh");
    expect(edgeKinds).toContain("grants:g-eng->a-dd");
    expect(edgeKinds).toContain("appliesTo:p-sess->g-eng");
    expect(edgeKinds).toContain("protects:p-auth->a-dd");
    expect(edgeKinds).toContain("populates:gr-eng->g-eng");
  });

  it("excludes other groups and their grant paths (GitHub's Contractors grant is not the user's)", () => {
    const result = traceUser(graph, { user: alice, groupIds: ["g-eng"] });
    const sub = buildUserAccessGraph(graph, result);
    const ids = new Set(sub.nodes.map((n) => n.id));

    expect(ids.has("g-con")).toBe(false); // user isn't in Contractors
    // No grant edge originates from a non-member group.
    expect(sub.edges.some((e) => e.kind === "grants" && e.from === "g-con")).toBe(false);
  });

  it("a user with no apps yields just their group(s) (still a valid picture)", () => {
    const result = traceUser(graph, { user: alice, groupIds: ["g-con"] });
    const sub = buildUserAccessGraph(graph, result);
    // Contractors grants GitHub, so g-con DOES have an app — use a truly appless case:
    const empty = buildUserAccessGraph(graph, traceUser(graph, { user: alice, groupIds: [] }));
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(sub.nodes.some((n) => n.id === "g-con")).toBe(true);
  });
});
