/**
 * M14 Phase B — fixture-verification for the built-in console app-policy identities.
 *
 * `BUILT_IN_APP_POLICY_NAMES` (src/analysis/okta-builtins.ts) justifies the identity-refined
 * exclusion reason ("access policy of Okta built-in console app"). To keep that claim honest —
 * "identities from captures, not hardcoded" — this test asserts every constant is actually present
 * in the sanitized capture as a `system:false` / `resourceType:"APP"` ACCESS_POLICY that NO app
 * references. If Okta renames a built-in, or a future capture makes one app-referenced, this fails
 * instead of the constant silently drifting from reality.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILT_IN_APP_POLICY_NAMES } from "../src/analysis/okta-builtins.js";

interface RawPolicyFixture {
  id: string;
  name: string;
  system?: boolean;
  _embedded?: { resourceType?: string };
}
interface RawAppFixture {
  _links?: { accessPolicy?: { href?: string } };
}

const POLICIES: RawPolicyFixture[] = JSON.parse(
  readFileSync(new URL("../fixtures/api-real/app-signon-policies.json", import.meta.url), "utf8"),
);
const APPS: RawAppFixture[] = JSON.parse(
  readFileSync(new URL("../fixtures/api-real/apps.json", import.meta.url), "utf8"),
);

/** Policy ids every app points at via its `_links.accessPolicy.href` (last path segment). */
const referencedPolicyIds = new Set(
  APPS.map((a) => a._links?.accessPolicy?.href?.split("/").filter(Boolean).at(-1)).filter(
    (id): id is string => Boolean(id),
  ),
);

describe("BUILT_IN_APP_POLICY_NAMES — verified against the capture", () => {
  for (const name of BUILT_IN_APP_POLICY_NAMES) {
    it(`"${name}" is a system:false / resourceType:APP policy referenced by no app`, () => {
      const matches = POLICIES.filter((p) => p.name === name);
      expect(matches, `no capture policy named "${name}"`).toHaveLength(1);
      const policy = matches[0];
      expect(policy.system).toBe(false);
      expect(policy._embedded?.resourceType).toBe("APP");
      expect(referencedPolicyIds.has(policy.id)).toBe(false);
    });
  }

  it("does not claim a built-in that the capture actually shows an app referencing", () => {
    // Guards the identity refinement as a whole: if any listed name maps to an app-referenced
    // policy, the constant is a lie regardless of the per-name assertions above.
    const referencedBuiltIns = POLICIES.filter(
      (p) =>
        (BUILT_IN_APP_POLICY_NAMES as readonly string[]).includes(p.name) &&
        referencedPolicyIds.has(p.id),
    );
    expect(referencedBuiltIns).toHaveLength(0);
  });
});
