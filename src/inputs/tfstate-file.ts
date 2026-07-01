/**
 * inputs/tfstate-file: read a `terraform show -json` file from disk.
 *
 * This is the I/O boundary. `src/core/` stays pure; all filesystem access lives here.
 */

import { readFile } from "node:fs/promises";

/** Read and JSON-parse a tfstate export. Returns the raw object for parseTfState. */
export async function readTfStateFile(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read state file "${path}": ${reason}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`State file "${path}" is not valid JSON: ${reason}`);
  }
}
