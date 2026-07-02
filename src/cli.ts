#!/usr/bin/env node
/**
 * CLI entrypoint (commander). Wires the pure core to file I/O and stdout rendering.
 *
 * Two input sources feed the same graph pipeline:
 *   --source tfstate (default): a `terraform show -json` export, via --state <path>
 *   --source okta: the live tenant, read-only, via OKTA_ORG_URL/OKTA_API_TOKEN env
 */

import { Command, Option } from "commander";
import { buildGraph } from "./core/build-graph.js";
import { parseTfState } from "./core/parse-tfstate.js";
import { summarize, trace } from "./core/access-paths.js";
import { readTfStateFile } from "./inputs/tfstate-file.js";
import { mapApiSnapshot } from "./inputs/map-api.js";
import {
  HttpOktaReader,
  readOktaConfigFromEnv,
  readTenantSnapshot,
} from "./inputs/okta-api.js";
import { renderSummary, renderTrace } from "./render/cli.js";
import type { OutputFormat } from "./render/cli.js";

interface SourceOpts {
  source: "tfstate" | "okta";
  state?: string;
}

async function loadGraph(opts: SourceOpts) {
  if (opts.source === "okta") {
    try {
      process.loadEnvFile(".env"); // optional convenience; env vars set directly also work
    } catch {
      /* no .env file — fine if the vars are already exported */
    }
    const reader = new HttpOktaReader(readOktaConfigFromEnv());
    return buildGraph(mapApiSnapshot(await readTenantSnapshot(reader)));
  }
  if (!opts.state) {
    throw new Error("--source tfstate requires --state <path> (a `terraform show -json` export).");
  }
  const state = await readTfStateFile(opts.state);
  return buildGraph(parseTfState(state));
}

const sourceOption = () =>
  new Option("--source <source>", "where to read the tenant from")
    .choices(["tfstate", "okta"])
    .default("tfstate");

const program = new Command();

program
  .name("okta-iac-lens")
  .description("Read Terraform-managed Okta config and trace access paths.")
  .version("0.1.0");

program
  .command("summary")
  .description("Count the Okta resources in a state export or the live tenant.")
  .addOption(sourceOption())
  .option("--state <path>", "path to `terraform show -json` output (tfstate source)")
  .option("--json", "output JSON instead of text")
  .action(async (opts: SourceOpts & { json?: boolean }) => {
    try {
      const graph = await loadGraph(opts);
      const format: OutputFormat = opts.json ? "json" : "text";
      console.log(renderSummary(summarize(graph), format));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command("trace")
  .description("Trace what a group grants and which policies gate it.")
  .requiredOption("--group <nameOrId>", "group display name or id")
  .addOption(sourceOption())
  .option("--state <path>", "path to `terraform show -json` output (tfstate source)")
  .option("--json", "output JSON instead of text")
  .action(async (opts: SourceOpts & { group: string; json?: boolean }) => {
    try {
      const graph = await loadGraph(opts);
      const format: OutputFormat = opts.json ? "json" : "text";
      console.log(renderTrace(trace(graph, opts.group), format));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
