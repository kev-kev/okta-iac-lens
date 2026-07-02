/**
 * live-smoke: Phase B smoke test against a real Okta tenant.
 *
 * Exercises the production `HttpOktaReader` (auth, every read endpoint, pagination)
 * and captures the raw responses to `generated/okta-captures/` (gitignored) so the
 * hand-authored `fixtures/api/*.json` shapes can be reconciled against reality.
 *
 * Prints shape findings, NOT full bodies: app->accessPolicy links, policy `system`
 * flags, sign-on policy group conditions. Never prints the token.
 *
 * With `--verify-readonly` it additionally attempts ONE write (create a group) and
 * expects Okta to refuse it (403) — proving the credential itself is read-only, per
 * the CLAUDE.md safety rail. If the write unexpectedly succeeds, the group is
 * deleted immediately and a loud warning is printed: the token is NOT read-only.
 *
 * Run: npx tsx scripts/live-smoke.ts [--verify-readonly]
 */

import { mkdir, writeFile } from "node:fs/promises";
import {
  HttpOktaReader,
  readOktaConfigFromEnv,
  readTenantSnapshot,
} from "../src/inputs/okta-api.js";

const CAPTURE_DIR = new URL("../generated/okta-captures/", import.meta.url);

function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file — fall through; readOktaConfigFromEnv gives the actionable error.
  }
}

/** Last path segment of a URL, e.g. ".../policies/abc123" -> "abc123". */
function tail(href: string | undefined): string {
  if (!href) return "(absent)";
  const parts = href.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "(absent)";
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = readOktaConfigFromEnv();
  const reader = new HttpOktaReader(config);

  console.log(`Smoke test against ${config.orgUrl}\n`);

  const snapshot = await readTenantSnapshot(reader);

  await mkdir(CAPTURE_DIR, { recursive: true });
  const captures: Record<string, unknown> = {
    "groups.json": snapshot.groups,
    "apps.json": snapshot.apps,
    "group-rules.json": snapshot.groupRules,
    "policies-signon.json": snapshot.globalSessionPolicies,
    "app-signon-policies.json": snapshot.appAuthPolicies,
    "apps-groups.json": snapshot.appGroupAssignments,
  };
  for (const [file, data] of Object.entries(captures)) {
    await writeFile(new URL(file, CAPTURE_DIR), JSON.stringify(data, null, 2));
  }
  console.log(`Captured raw responses to generated/okta-captures/\n`);

  // --- Shape findings ---------------------------------------------------------
  console.log(`Groups (${snapshot.groups.length}):`);
  for (const g of snapshot.groups) {
    console.log(`  - ${g.id}  name=${JSON.stringify(g.profile?.name)}`);
  }

  console.log(`\nApps (${snapshot.apps.length}):`);
  for (const a of snapshot.apps) {
    const assigned = snapshot.appGroupAssignments[a.id] ?? [];
    console.log(
      `  - ${a.id}  label=${JSON.stringify(a.label)}  name=${a.name}  signOnMode=${a.signOnMode}` +
        `  accessPolicy=${tail(a._links?.accessPolicy?.href)}  assignedGroups=${assigned.length}`,
    );
  }

  console.log(`\nGroup rules (${snapshot.groupRules.length}):`);
  for (const r of snapshot.groupRules) {
    console.log(
      `  - ${r.id}  name=${JSON.stringify(r.name)}  expr=${JSON.stringify(r.conditions?.expression?.value)}` +
        `  assigns=${JSON.stringify(r.actions?.assignUserToGroups?.groupIds)}`,
    );
  }

  console.log(`\nGlobal session policies / OKTA_SIGN_ON (${snapshot.globalSessionPolicies.length}):`);
  for (const p of snapshot.globalSessionPolicies) {
    console.log(
      `  - ${p.id}  name=${JSON.stringify(p.name)}  system=${p.system}` +
        `  groupsInclude=${JSON.stringify(p.conditions?.people?.groups?.include)}`,
    );
  }

  console.log(`\nApp auth policies / ACCESS_POLICY (${snapshot.appAuthPolicies.length}):`);
  for (const p of snapshot.appAuthPolicies) {
    console.log(`  - ${p.id}  name=${JSON.stringify(p.name)}  system=${p.system}`);
  }

  // --- Optional read-only verification -----------------------------------------
  if (process.argv.includes("--verify-readonly")) {
    console.log(`\nVerifying the credential cannot write (POST /api/v1/groups)...`);
    const res = await fetch(new URL("/api/v1/groups", config.orgUrl), {
      method: "POST",
      headers: {
        Authorization: `SSWS ${config.apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile: { name: "smoke-test-readonly-probe", description: "should be refused" },
      }),
    });
    if (res.status === 403 || res.status === 401) {
      console.log(`  OK: write refused with ${res.status} — credential is read-only.`);
    } else if (res.ok) {
      const created = (await res.json()) as { id: string };
      console.log(`  !!! WARNING: write SUCCEEDED (${res.status}) — this token is NOT read-only.`);
      const del = await fetch(new URL(`/api/v1/groups/${created.id}`, config.orgUrl), {
        method: "DELETE",
        headers: { Authorization: `SSWS ${config.apiToken}` },
      });
      console.log(
        `  Cleaned up probe group ${created.id} (delete -> ${del.status}). ` +
          `Re-mint the token from a Read-Only Administrator account.`,
      );
    } else {
      console.log(`  Unexpected status ${res.status} ${res.statusText} — inspect manually.`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
