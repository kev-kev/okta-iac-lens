/**
 * M2 oracle: the live-API path and the tfstate path, given the same logical tenant,
 * must produce the same graph. `fixtures/api/` describes the SAME tenant as
 * `fixtures/sample-tenant.tfstate.json`; equivalence between the two built graphs is
 * the strongest offline check available without a live tenant.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarize, trace } from "../src/core/access-paths.js";
import { buildGraph } from "../src/core/build-graph.js";
import type { GraphNode, OktaGraph } from "../src/core/model.js";
import { mapApiSnapshot } from "../src/inputs/map-api.js";
import { readOktaConfigFromEnv } from "../src/inputs/okta-api.js";
import type {
  OktaApiSnapshot,
  RawApp,
  RawAppGroupAssignment,
  RawGroup,
  RawGroupRule,
  RawPolicy,
} from "../src/inputs/okta-api.js";
import { graphFromFixture } from "./fixture.js";

const API_FIXTURE_DIR = new URL("../fixtures/api/", import.meta.url);

function readApiFixture<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, API_FIXTURE_DIR), "utf8")) as T;
}

/** Assemble the snapshot exactly as `readTenantSnapshot` would, but from disk. */
function loadApiSnapshot(): OktaApiSnapshot {
  return {
    groups: readApiFixture<RawGroup[]>("groups.json"),
    apps: readApiFixture<RawApp[]>("apps.json"),
    groupRules: readApiFixture<RawGroupRule[]>("group-rules.json"),
    globalSessionPolicies: readApiFixture<RawPolicy[]>("policies-signon.json"),
    appAuthPolicies: readApiFixture<RawPolicy[]>("app-signon-policies.json"),
    appGroupAssignments:
      readApiFixture<Record<string, RawAppGroupAssignment[]>>("apps-groups.json"),
  };
}

function graphFromApiFixtures(): OktaGraph {
  return buildGraph(mapApiSnapshot(loadApiSnapshot()));
}

/**
 * Strip the fields that legitimately differ between the tfstate and API paths — `address`
 * (provenance) and the M12 additive annotations `status`/`priority` (the idealized oracle
 * fixtures carry them inconsistently: sample-tenant declares `status: ACTIVE`, the doc-derived
 * api fixtures omit it). Their equivalence is proven separately by the real fixtures. Then sort,
 * so graphs compare as sets — the oracle asserts STRUCTURAL equivalence (nodes/edges/layering).
 */
function comparable(graph: OktaGraph) {
  const nodes = graph.nodes
    .map((n: GraphNode) => {
      const { address: _address, ...rest } = n as GraphNode & { status?: string; priority?: number };
      delete rest.status;
      delete rest.priority;
      return rest;
    })
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const edges = [...graph.edges].sort((a, b) =>
    `${a.kind}:${a.from}:${a.to}`.localeCompare(`${b.kind}:${b.from}:${b.to}`),
  );
  return { nodes, edges };
}

describe("mapApiSnapshot -> buildGraph (M2 oracle)", () => {
  it("trace(Engineering) matches the M1 oracle", () => {
    const result = trace(graphFromApiFixtures(), "Engineering");
    expect(result.apps.map((a) => a.name)).toEqual(["GitHub", "Datadog"]);
    expect(result.globalSessionPolicy?.name).toBe("Default-MFA");
    expect(result.appAuthPolicies["a-gh"]).toBeNull();
    expect(result.appAuthPolicies["a-dd"]?.name).toBe("Strict-Auth");
  });

  it("trace(Contractors) matches the M1 oracle", () => {
    const result = trace(graphFromApiFixtures(), "Contractors");
    expect(result.apps.map((a) => a.name)).toEqual(["GitHub"]);
    expect(result.globalSessionPolicy).toBeNull();
    expect(result.appAuthPolicies).toEqual({ "a-gh": null });
  });

  it("summary counts match the M1 oracle", () => {
    expect(summarize(graphFromApiFixtures())).toEqual({
      groups: 2,
      apps: 2,
      groupRules: 1,
      globalSessionPolicies: 1,
      appAuthPolicies: 1,
    });
  });

  it("API-built graph equals the tfstate-built graph (modulo provenance + order)", () => {
    expect(comparable(graphFromApiFixtures())).toEqual(comparable(graphFromFixture()));
  });

  it("an app pointing at a system ACCESS_POLICY maps to org default (null), not a protects edge", () => {
    const resources = mapApiSnapshot(loadApiSnapshot());
    const github = resources.find((r) => r.kind === "App" && r.id === "a-gh");
    expect(github).toMatchObject({ authenticationPolicyId: null });
    const graph = graphFromApiFixtures();
    expect(graph.edges.some((e) => e.kind === "protects" && e.to === "a-gh")).toBe(false);
    // ...and the system policy itself is not modeled as managed config.
    expect(graph.nodes.some((n) => n.id === "p-default")).toBe(false);
  });
});

describe("readOktaConfigFromEnv", () => {
  it("throws an actionable error when env vars are missing", () => {
    expect(() => readOktaConfigFromEnv({})).toThrow(/OKTA_ORG_URL and OKTA_API_TOKEN/);
  });

  it("reads org url and token when both are set", () => {
    const env = { OKTA_ORG_URL: "https://example.okta.com", OKTA_API_TOKEN: "t0ken" };
    expect(readOktaConfigFromEnv(env)).toEqual({
      orgUrl: "https://example.okta.com",
      apiToken: "t0ken",
    });
  });
});
