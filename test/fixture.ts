/** Shared test helpers for loading the sample fixture. Not a test file itself. */

import { readFileSync } from "node:fs";
import { buildGraph } from "../src/core/build-graph.js";
import { parseTfState } from "../src/core/parse-tfstate.js";
import type { OktaGraph } from "../src/core/model.js";

const FIXTURE_URL = new URL("../fixtures/sample-tenant.tfstate.json", import.meta.url);

export function loadFixtureJson(): unknown {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
}

export function graphFromFixture(): OktaGraph {
  return buildGraph(parseTfState(loadFixtureJson()));
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
