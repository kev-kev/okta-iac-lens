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
import type { ParsedResource } from "../src/core/parse-tfstate.js";
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
import {
  graphFromFixture,
  loadRealApiSnapshot,
  realLiveResources,
  realStateResources,
} from "./fixture.js";

type OfKind<K extends ParsedResource["kind"]> = Extract<ParsedResource, { kind: K }>;
function byKind<K extends ParsedResource["kind"]>(
  resources: ParsedResource[],
  kind: K,
): OfKind<K>[] {
  return resources.filter((r): r is OfKind<K> => r.kind === kind);
}

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
    policyRules: {}, // idealized fixtures predate M15 rules
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

describe("mapApiSnapshot — M15 app auth policy rules", () => {
  it("normalizes live nested constraints into AppAuthPolicyRule records for a managed policy", () => {
    const rules = byKind(realLiveResources(), "AppAuthPolicyRule");

    const pr2fa = rules.find((r) => r.name === "Require-Phishing-Resistant");
    expect(pr2fa).toMatchObject({ access: "ALLOW", factorMode: "2FA" });
    expect(pr2fa?.constraints.some((c) => c.possession?.phishingResistant === "REQUIRED")).toBe(true);

    const oneFa = rules.find((r) => r.name === "Contractors-Password-Bypass");
    expect(oneFa).toMatchObject({ access: "ALLOW", factorMode: "1FA" });
    expect(oneFa?.constraints.some((c) => c.knowledge?.types?.includes("password"))).toBe(true);
  });

  it("does NOT emit rules for a non-APP access policy (END_USER_ACCOUNT_MANAGEMENT)", () => {
    const snapshot = loadRealApiSnapshot();
    const acctMgmt = snapshot.appAuthPolicies.find(
      (p) => p._embedded?.resourceType === "END_USER_ACCOUNT_MANAGEMENT",
    );
    expect(acctMgmt).toBeDefined(); // the real fixture carries one — its rules must be dropped

    const emitted = byKind(mapApiSnapshot(snapshot), "AppAuthPolicyRule");
    expect(emitted.some((r) => r.policyId === acctMgmt!.id)).toBe(false);
    // The Identity-Engine `2FA_If_Possible` catch-all lives only in that policy — it must not leak in.
    expect(emitted.some((r) => r.factorMode === "2FA_If_Possible")).toBe(false);
  });

  it("keeps the system org-default's rules (they source its strength band), keyed by that policy", () => {
    const snapshot = loadRealApiSnapshot();
    const orgDefault = snapshot.appAuthPolicies.find((p) => p.system === true);
    expect(orgDefault).toBeDefined();
    const emitted = byKind(mapApiSnapshot(snapshot), "AppAuthPolicyRule");
    // The system policy is not a managed AppAuthPolicy node, but its rules ARE captured for banding.
    expect(emitted.some((r) => r.policyId === orgDefault!.id && r.system === true)).toBe(true);
  });

  it("the managed policy's rules match across the tfstate and live paths (modulo the live-only catch-all + provenance)", () => {
    const stripAddress = (r: OfKind<"AppAuthPolicyRule">) => {
      const { address: _address, ...rest } = r;
      return rest;
    };
    const norm = (rules: OfKind<"AppAuthPolicyRule">[]) =>
      rules.map(stripAddress).sort((a, b) => a.id.localeCompare(b.id));

    const stateRules = byKind(realStateResources(), "AppAuthPolicyRule");
    expect(stateRules.length).toBeGreaterThan(0);
    // The seed manages exactly one app-auth policy (Strict-Auth) — all its rules share that id.
    const managedPolicyId = stateRules[0].policyId;
    expect(stateRules.every((r) => r.policyId === managedPolicyId)).toBe(true);

    // On the live side the same policy also returns the Okta system catch-all (unmanaged, absent
    // from tfstate) — exclude it, then the managed rules must be byte-for-byte equal.
    const liveManaged = byKind(realLiveResources(), "AppAuthPolicyRule").filter(
      (r) => r.policyId === managedPolicyId && r.system !== true,
    );
    expect(norm(liveManaged)).toEqual(norm(stateRules));
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
