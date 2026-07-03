#!/usr/bin/env node
/**
 * CLI entrypoint (commander). Wires the pure core/analysis to file I/O and stdout rendering.
 *
 *   summary  / trace    — one input source (--source tfstate | okta)
 *   coverage            — BOTH sources: live tenant vs Terraform state -> IaC gap
 */

import { writeFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { buildGraph } from "./core/build-graph.js";
import { summarize, trace } from "./core/access-paths.js";
import { computeCoverage } from "./analysis/coverage.js";
import { generateImportBlocks } from "./analysis/import-blocks.js";
import { loadDotEnv, loadLiveResources, loadStateResources } from "./inputs/load-resources.js";
import { renderCoverage, renderSummary, renderTrace } from "./render/cli.js";
import type { OutputFormat } from "./render/cli.js";
import { makeEnvelope } from "./render/envelope.js";

interface SourceOpts {
  source: "tfstate" | "okta";
  state?: string;
}

async function loadGraph(opts: SourceOpts) {
  if (opts.source === "okta") {
    loadDotEnv();
    return buildGraph(await loadLiveResources());
  }
  if (!opts.state) {
    throw new Error("--source tfstate requires --state <path> (a `terraform show -json` export).");
  }
  return buildGraph(await loadStateResources(opts.state));
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

program
  .command("coverage")
  .description("Reconcile the live tenant against Terraform state; report IaC coverage and gaps.")
  .requiredOption("--state <path>", "path to `terraform show -json` output (the managed baseline)")
  .option("--json", "output JSON instead of text")
  .option("--imports <path>", "write generated Terraform import blocks to this .tf file")
  .option("--viz <path>", "write a graph envelope with the coverage overlay for the web viewer")
  .action(async (opts: { state: string; json?: boolean; imports?: string; viz?: string }) => {
    try {
      loadDotEnv();
      const state = await loadStateResources(opts.state);
      const live = await loadLiveResources();
      const report = computeCoverage(live, state);
      const format: OutputFormat = opts.json ? "json" : "text";

      console.log(renderCoverage(report, format));
      if (format === "text" && report.overall.unmanaged > 0) {
        console.log("");
        console.log(generateImportBlocks(report, live));
      }
      if (opts.imports) {
        await writeFile(opts.imports, generateImportBlocks(report, live), "utf8");
        console.error(`Wrote ${report.overall.unmanaged} import block(s) to ${opts.imports}`);
      }
      if (opts.viz) {
        // Embed the live graph (already fetched — no extra API calls) plus the coverage overlay.
        const envelope = makeEnvelope(buildGraph(live), "okta", new Date().toISOString(), report);
        await writeFile(opts.viz, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
        console.error(`Wrote coverage viz (${report.items.length} classified) to ${opts.viz}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command("export")
  .description("Export the access graph as a JSON envelope for the web viewer.")
  .addOption(sourceOption())
  .option("--state <path>", "path to `terraform show -json` output (tfstate source)")
  .option("-o, --output <path>", "where to write the graph envelope", "generated/graph.json")
  .action(async (opts: SourceOpts & { output: string }) => {
    try {
      const graph = await loadGraph(opts);
      const envelope = makeEnvelope(graph, opts.source, new Date().toISOString());
      await writeFile(opts.output, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
      console.error(
        `Wrote ${graph.nodes.length} nodes / ${graph.edges.length} edges to ${opts.output}`,
      );
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
