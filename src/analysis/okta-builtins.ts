/**
 * analysis/okta-builtins: capture-verified identities of Okta's built-in console app access
 * policies. PURE — plain constants, no I/O.
 *
 * Okta seeds every tenant with hidden console apps (Admin Console, Dashboard, Browser Plugin,
 * OIN Submission Tester). In `/api/v1/apps` they don't appear at all, but each still owns an
 * ACCESS_POLICY object (`system:false`, `resourceType:"APP"`) that surfaces under
 * `GET /policies?type=ACCESS_POLICY`. Those policies are Okta-managed and NOT Terraform-manageable,
 * so coverage excludes them — but only their IDENTITY (name) may justify the "Okta built-in console"
 * reason string. Identity NEVER decides the bucket (a custom policy spoof-named "Okta Dashboard"
 * that a real app references still lands `unmanaged`); it only refines the exclusion reason.
 *
 * These names are not hardcoded folklore: `test/okta-builtins.test.ts` asserts every entry exists
 * in `fixtures/api-real/app-signon-policies.json` with `system:false`/`resourceType:"APP"` and is
 * referenced by no app in `fixtures/api-real/apps.json`. Claim-vs-capture drift fails that test.
 */

/** Display names of the built-in console app access policies, verified against the capture. */
export const BUILT_IN_APP_POLICY_NAMES = [
  "Okta Admin Console",
  "Okta Dashboard",
  "Okta Browser Plugin",
  "Okta OIN Submission Tester",
] as const;

const BUILT_IN_APP_POLICY_NAME_SET: ReadonlySet<string> = new Set(BUILT_IN_APP_POLICY_NAMES);

/** True iff `name` is a capture-verified built-in console app access policy name. */
export function isBuiltInAppPolicyName(name: string): boolean {
  return BUILT_IN_APP_POLICY_NAME_SET.has(name);
}
