#!/usr/bin/env node
/**
 * CLI entrypoint (commander). Wires the pure core to file I/O and stdout rendering.
 */

import { Command } from "commander";
import { buildGraph } from "./core/build-graph.js";
import { parseTfState } from "./core/parse-tfstate.js";
import { summarize, trace } from "./core/access-paths.js";
import { readTfStateFile } from "./inputs/tfstate-file.js";
import { renderSummary, renderTrace } from "./render/cli.js";
import type { OutputFormat } from "./render/cli.js";

async function loadGraph(statePath: string) {
  const state = await readTfStateFile(statePath);
  return buildGraph(parseTfState(state));
}

const program = new Command();

program
  .name("okta-iac-lens")
  .description("Read Terraform-managed Okta config and trace access paths.")
  .version("0.1.0");

program
  .command("summary")
  .description("Count the Okta resources under IaC in a state export.")
  .requiredOption("--state <path>", "path to `terraform show -json` output")
  .option("--json", "output JSON instead of text")
  .action(async (opts: { state: string; json?: boolean }) => {
    try {
      const graph = await loadGraph(opts.state);
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
  .requiredOption("--state <path>", "path to `terraform show -json` output")
  .option("--json", "output JSON instead of text")
  .action(async (opts: { group: string; state: string; json?: boolean }) => {
    try {
      const graph = await loadGraph(opts.state);
      const format: OutputFormat = opts.json ? "json" : "text";
      console.log(renderTrace(trace(graph, opts.group), format));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
