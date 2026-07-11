/**
 * sanitize-captures: turn the gitignored raw tenant artifacts into committable,
 * structure-true fixtures (CLAUDE.md safety rail — never commit a raw export).
 *
 * Reads the raw captures written by `live-smoke` (generated/okta-captures/) AND the
 * raw `terraform show -json` export (fixtures/real-tenant.tfstate.json), then writes
 * sanitized copies under fixtures/api-real/. Both output sets are scrubbed with ONE
 * shared id map, so a group/app/policy id means the same thing in the API fixtures and
 * in the state fixture — the M11 Phase D equivalence oracle depends on that.
 *
 * What is scrubbed (structure preserved 1:1, only identifying VALUES change):
 *   - org subdomain          integrator-1546176  -> integrator-0000000
 *   - every Okta object id    (00g…/0oa…/00p…/rst…/0pr…/00o…/00u…/aln…, 20 alnum chars)
 *                             -> <same 4-char prefix> + sha1(id)[:16]  (still Okta-shaped)
 *   - OIDC signing `kid`      -> fixed fake (public key id, scrubbed for cleanliness)
 *   - `client_secret` values  -> fixed fake per distinct secret (the only true secret)
 *
 * Names/labels (Datadog, Engineering, test.user@example.com, …) are already synthetic
 * seed data, so they pass through unchanged. This script contains NO secrets and is
 * committed; the sanitized OUTPUT is committed; the raw INPUTS stay gitignored.
 *
 * Run: npx tsx scripts/sanitize-captures.ts
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const CAPTURE_DIR = new URL("generated/okta-captures/", ROOT);
const RAW_STATE = new URL("fixtures/real-tenant.tfstate.json", ROOT);
const OUT_DIR = new URL("fixtures/api-real/", ROOT);

const CAPTURE_FILES = [
  "groups.json",
  "apps.json",
  "group-rules.json",
  "policies-signon.json",
  "app-signon-policies.json",
  "apps-groups.json",
] as const;

// --- fixed, non-id scrubs (exact-string replacements) ------------------------
const REAL_SUBDOMAIN = "integrator-1546176";
const FAKE_SUBDOMAIN = "integrator-0000000";
const REAL_KID = "ZEdGkT8zQLwANTwFG83e0HOQ9d5kNc9e2Fz2VcXYvLM";
// Same length as REAL_KID (43); hyphens guarantee no clean 20-char run for the id pass.
const FAKE_KID = "sanitized-kid-0000000000000000000000000000";

/**
 * Okta object id: exactly 20 alphanumerics, not adjacent to more alphanumerics.
 * The boundary guards are what keep the 43-char `kid` and 64-char `client_secret`
 * (both longer runs / containing -,_) from being partially matched.
 */
const OKTA_ID = /(?<![0-9A-Za-z])[0-9A-Za-z]{20}(?![0-9A-Za-z])/g;

const idMap = new Map<string, string>();
function fakeId(realId: string): string {
  const cached = idMap.get(realId);
  if (cached) return cached;
  const prefix = realId.slice(0, 4); // e.g. "00g1", "0oa1" — preserves the kind's look
  const digest = createHash("sha1").update(realId).digest("hex").slice(0, 16);
  const fake = prefix + digest; // 4 + 16 = 20, still [0-9a-z]
  idMap.set(realId, fake);
  return fake;
}

const secretMap = new Map<string, string>();
function fakeSecret(realSecret: string): string {
  const cached = secretMap.get(realSecret);
  if (cached) return cached;
  // Same length as the real 64-char secret; hyphens ⇒ no clean 20-char run.
  const label = `sanitized-secret-${secretMap.size + 1}`;
  const fake = label.padEnd(realSecret.length, "-x").slice(0, realSecret.length);
  secretMap.set(realSecret, fake);
  return fake;
}

/** Apply every scrub to one file's raw text; validate it is still JSON. */
function sanitize(raw: string): string {
  let text = raw.split(REAL_SUBDOMAIN).join(FAKE_SUBDOMAIN);
  text = text.split(REAL_KID).join(FAKE_KID);
  text = text.replace(/"client_secret":"([^"]*)"/g, (_m, secret: string) =>
    secret ? `"client_secret":"${fakeSecret(secret)}"` : `"client_secret":""`,
  );
  text = text.replace(OKTA_ID, (id) => fakeId(id));
  JSON.parse(text); // throws if a scrub corrupted the structure
  return text;
}

function readText(url: URL): string {
  // Strip a leading UTF-8 BOM — `terraform show -json | Out-File -Encoding utf8`
  // on Windows PowerShell 5.1 prepends one, which would break JSON.parse.
  return readFileSync(url, "utf8").replace(/^﻿/, "");
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  // Pass 1: discover every id/secret across ALL inputs first, so the map is shared
  // and stable regardless of the order files are written.
  const inputs: Array<{ name: string; raw: string; out: URL }> = [];
  for (const file of CAPTURE_FILES) {
    inputs.push({
      name: file,
      raw: readText(new URL(file, CAPTURE_DIR)),
      out: new URL(file, OUT_DIR),
    });
  }
  inputs.push({
    name: "tenant.tfstate.json",
    raw: readText(RAW_STATE),
    out: new URL("tenant.tfstate.json", OUT_DIR),
  });

  for (const { raw } of inputs) {
    for (const m of raw.matchAll(OKTA_ID)) fakeId(m[0]);
    for (const m of raw.matchAll(/"client_secret":"([^"]*)"/g)) {
      if (m[1]) fakeSecret(m[1]);
    }
  }

  // Pass 2: rewrite.
  for (const { name, raw, out } of inputs) {
    const cleaned = sanitize(raw);
    writeFileSync(out, cleaned.endsWith("\n") ? cleaned : cleaned + "\n");
    console.log(`  wrote ${name}`);
  }

  // Leak guard: fail loudly if any real identifier survived into an output.
  const outputs = inputs.map(({ out }) => readText(out)).join("\n");
  const leaks: string[] = [];
  if (outputs.includes(REAL_SUBDOMAIN)) leaks.push(REAL_SUBDOMAIN);
  if (outputs.includes(REAL_KID)) leaks.push(REAL_KID);
  for (const realSecret of secretMap.keys()) {
    if (outputs.includes(realSecret)) leaks.push("client_secret");
  }
  for (const realId of idMap.keys()) {
    if (new RegExp(`(?<![0-9A-Za-z])${realId}(?![0-9A-Za-z])`).test(outputs)) {
      leaks.push(realId);
    }
  }
  if (leaks.length > 0) {
    console.error(`\nLEAK: real values survived sanitization: ${leaks.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nSanitized ${inputs.length} files -> fixtures/api-real/  ` +
      `(${idMap.size} ids, ${secretMap.size} secrets scrubbed). No real values leaked.`,
  );
}

main();
