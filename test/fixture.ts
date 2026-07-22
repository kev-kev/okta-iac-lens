/** Shared test helpers for loading the sample fixtures. Not a test file itself. */

import { readFileSync } from "node:fs";
import { buildGraph } from "../src/core/build-graph.js";
import { parseTfState } from "../src/core/parse-tfstate.js";
import type { ParsedResource } from "../src/core/parse-tfstate.js";
import type { OktaGraph } from "../src/core/model.js";
import { mapApiSnapshot } from "../src/inputs/map-api.js";
import type {
  OktaApiSnapshot,
  RawApp,
  RawAppGroupAssignment,
  RawGroup,
  RawGroupRule,
  RawPolicy,
  RawPolicyRule,
} from "../src/inputs/okta-api.js";

const FIXTURE_URL = new URL("../fixtures/sample-tenant.tfstate.json", import.meta.url);
const API_FIXTURE_DIR = new URL("../fixtures/api/", import.meta.url);

// M11 Phase D: the SANITIZED real-tenant captures + state (structure-true, fake ids/values).
// These carry the adversarial seed the review predicted divergence on; the idealized
// `fixtures/api/` + `sample-tenant` above stay the oracles for the green unit tests.
const REAL_STATE_URL = new URL("../fixtures/api-real/tenant.tfstate.json", import.meta.url);
const API_REAL_DIR = new URL("../fixtures/api-real/", import.meta.url);

export function loadFixtureJson(): unknown {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
}

export function graphFromFixture(): OktaGraph {
  return buildGraph(parseTfState(loadFixtureJson()));
}

/** The tfstate fixture as normalized records (the "state" side of coverage). */
export function stateResources(): ParsedResource[] {
  return parseTfState(loadFixtureJson());
}

function readApiFixture<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, API_FIXTURE_DIR), "utf8")) as T;
}

/** Assemble the API snapshot from `fixtures/api/`, exactly as `readTenantSnapshot` would. */
export function loadApiSnapshot(): OktaApiSnapshot {
  return {
    groups: readApiFixture<RawGroup[]>("groups.json"),
    apps: readApiFixture<RawApp[]>("apps.json"),
    groupRules: readApiFixture<RawGroupRule[]>("group-rules.json"),
    globalSessionPolicies: readApiFixture<RawPolicy[]>("policies-signon.json"),
    appAuthPolicies: readApiFixture<RawPolicy[]>("app-signon-policies.json"),
    appGroupAssignments: readApiFixture<Record<string, RawAppGroupAssignment[]>>("apps-groups.json"),
    // The idealized fixtures predate M15 rules — no rule captures, so no strength records.
    policyRules: {},
  };
}

/** The API fixtures as normalized records (the "live" side of coverage). */
export function liveResources(): ParsedResource[] {
  return mapApiSnapshot(loadApiSnapshot());
}

// --- M11 Phase D: sanitized real-tenant fixtures (the adversarial-seed side) ---

function readRealApiFixture<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, API_REAL_DIR), "utf8")) as T;
}

/** The sanitized real-tenant state export as raw JSON. */
export function loadRealStateJson(): unknown {
  return JSON.parse(readFileSync(REAL_STATE_URL, "utf8"));
}

/** The sanitized real-tenant state as normalized records. */
export function realStateResources(): ParsedResource[] {
  return parseTfState(loadRealStateJson());
}

/** The sanitized real-tenant state as a graph. */
export function realStateGraph(): OktaGraph {
  return buildGraph(realStateResources());
}

/** Assemble the API snapshot from `fixtures/api-real/`, exactly as `readTenantSnapshot` would. */
export function loadRealApiSnapshot(): OktaApiSnapshot {
  return {
    groups: readRealApiFixture<RawGroup[]>("groups.json"),
    apps: readRealApiFixture<RawApp[]>("apps.json"),
    groupRules: readRealApiFixture<RawGroupRule[]>("group-rules.json"),
    globalSessionPolicies: readRealApiFixture<RawPolicy[]>("policies-signon.json"),
    appAuthPolicies: readRealApiFixture<RawPolicy[]>("app-signon-policies.json"),
    appGroupAssignments: readRealApiFixture<Record<string, RawAppGroupAssignment[]>>("apps-groups.json"),
    policyRules: readRealApiFixture<Record<string, RawPolicyRule[]>>("app-signon-policy-rules.json"),
  };
}

/** The sanitized real-tenant captures as normalized records (the "live" side). */
export function realLiveResources(): ParsedResource[] {
  return mapApiSnapshot(loadRealApiSnapshot());
}

/** The sanitized real-tenant captures as a graph. */
export function realLiveGraph(): OktaGraph {
  return buildGraph(realLiveResources());
}

/**
 * Hoist every nested child_module resource up into root_module.resources and empty
 * child_modules — a "flattened" copy used to prove module nesting doesn't change results.
 */
export function flattenModules(state: unknown): unknown {
  const clone = structuredClone(state) as {
    values: { root_module: { resources?: unknown[]; child_modules?: unknown[] } };
  };
  const root = clone.values.root_module;
  const all: unknown[] = [];
  const walk = (mod: { resources?: unknown[]; child_modules?: unknown[] }): void => {
    for (const r of mod.resources ?? []) all.push(r);
    for (const c of mod.child_modules ?? []) {
      walk(c as { resources?: unknown[]; child_modules?: unknown[] });
    }
  };
  walk(root);
  root.resources = all;
  root.child_modules = [];
  return clone;
}
