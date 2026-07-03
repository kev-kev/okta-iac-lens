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
} from "../src/inputs/okta-api.js";

const FIXTURE_URL = new URL("../fixtures/sample-tenant.tfstate.json", import.meta.url);
const API_FIXTURE_DIR = new URL("../fixtures/api/", import.meta.url);

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
  };
}

/** The API fixtures as normalized records (the "live" side of coverage). */
export function liveResources(): ParsedResource[] {
  return mapApiSnapshot(loadApiSnapshot());
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
