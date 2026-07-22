/**
 * map-api: raw Okta API snapshot -> normalized `ParsedResource[]`.
 *
 * PURE. No I/O, no network — the API-side analogue of `parse-tfstate.ts`. Feeding
 * this module's output into the existing `buildGraph` must yield the same graph the
 * tfstate path yields for the same tenant; that equivalence is the M2 test oracle.
 * (Type-only imports from okta-api.ts keep this module free of its I/O code.)
 *
 * Semantics carried over from M1 (see model.ts):
 *  - The two policy layers stay separate: OKTA_SIGN_ON -> GlobalSessionPolicy,
 *    ACCESS_POLICY -> AppAuthPolicy.
 *  - "No app auth policy" == org default, never "no auth". Live, EVERY app has an
 *    `accessPolicy` link (unlike tfstate, where unset config = absent attribute), so
 *    the default is recognized structurally: apps pointing at a `system: true`
 *    policy map to `authenticationPolicyId: null`, and system policies do not
 *    become AppAuthPolicy nodes. Known edge case: a Terraform config that
 *    EXPLICITLY assigns the org-default policy will show a `protects` edge on the
 *    tfstate path but null here — acceptable, flagged for M3 reconciliation.
 */

import { toRuleConstraint } from "../core/parse-tfstate.js";
import type { ParsedResource } from "../core/parse-tfstate.js";
import type { OktaApiSnapshot, RawApp } from "./okta-api.js";

/**
 * signOnMode -> the Terraform resource type an IaC admin would recognize the app as.
 * Keeps `appType` comparable across the tfstate and live paths. Unknown modes fall
 * back to a tagged placeholder rather than guessing.
 */
const SIGN_ON_MODE_TO_TF_TYPE: Record<string, string> = {
  OPENID_CONNECT: "okta_app_oauth",
  SAML_2_0: "okta_app_saml",
  BOOKMARK: "okta_app_bookmark",
  AUTO_LOGIN: "okta_app_auto_login",
  BROWSER_PLUGIN: "okta_app_swa",
  SECURE_PASSWORD_STORE: "okta_app_secure_password_store",
  WS_FEDERATION: "okta_app_ws_federation",
};

function appTypeOf(app: RawApp): string {
  const mode = app.signOnMode ?? "";
  return SIGN_ON_MODE_TO_TF_TYPE[mode] ?? `okta_app_unknown:${mode || "(none)"}`;
}

/** Last path segment of the accessPolicy href, e.g. ".../policies/abc" -> "abc". */
function accessPolicyIdOf(app: RawApp): string | null {
  const href = app._links?.accessPolicy?.href;
  if (!href) return null;
  const parts = href.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** Map a full tenant snapshot to the normalized records `buildGraph` consumes. */
export function mapApiSnapshot(snapshot: OktaApiSnapshot): ParsedResource[] {
  const out: ParsedResource[] = [];

  // Org-default machinery: ids of system ACCESS_POLICYs (see module doc).
  const systemPolicyIds = new Set(
    snapshot.appAuthPolicies.filter((p) => p.system === true).map((p) => p.id),
  );

  for (const g of snapshot.groups) {
    out.push({
      kind: "Group",
      id: g.id,
      name: g.profile?.name ?? "",
      address: `okta-api:group/${g.id}`,
      groupType: g.type,
    });
  }

  for (const app of snapshot.apps) {
    const policyId = accessPolicyIdOf(app);
    out.push({
      kind: "App",
      id: app.id,
      name: app.label,
      appType: appTypeOf(app),
      address: `okta-api:app/${app.id}`,
      authenticationPolicyId:
        policyId !== null && !systemPolicyIds.has(policyId) ? policyId : null,
      status: app.status || undefined,
      // Catalog slug (NOT the display label) — live-only, for the built-in-app exclusion
      // contingency. Omit when empty so the field stays truly optional (groupType precedent).
      ...(app.name ? { catalogName: app.name } : {}),
    });
  }

  for (const rule of snapshot.groupRules) {
    out.push({
      kind: "GroupRule",
      id: rule.id,
      name: rule.name,
      address: `okta-api:group_rule/${rule.id}`,
      expression: rule.conditions?.expression?.value ?? "",
      expressionType: rule.conditions?.expression?.type || undefined,
      populates: rule.actions?.assignUserToGroups?.groupIds ?? [],
      status: rule.status || undefined,
    });
  }

  for (const policy of snapshot.globalSessionPolicies) {
    out.push({
      kind: "GlobalSessionPolicy",
      id: policy.id,
      name: policy.name,
      address: `okta-api:policy_signon/${policy.id}`,
      groupsIncluded: policy.conditions?.people?.groups?.include ?? [],
      system: policy.system === true,
      priority: policy.priority,
      status: policy.status || undefined,
    });
  }

  for (const policy of snapshot.appAuthPolicies) {
    if (policy.system === true) continue; // org-default machinery, not managed config
    // Only APP-typed access policies are app sign-on policies; a non-APP resourceType
    // (e.g. END_USER_ACCOUNT_MANAGEMENT) is not one. Missing == APP, so the doc-derived
    // M2 fixtures (which omit `_embedded`) still emit their app policies.
    const resourceType = policy._embedded?.resourceType;
    if (resourceType != null && resourceType !== "APP") continue;
    out.push({
      kind: "AppAuthPolicy",
      id: policy.id,
      name: policy.name,
      address: `okta-api:app_signon_policy/${policy.id}`,
      priority: policy.priority,
      status: policy.status || undefined,
    });
  }

  // App-auth policy RULES (M15 Phase A). Emit an AppAuthPolicyRule per rule, but ONLY for APP-typed
  // access policies — the same resourceType gate the node loop uses, so a non-APP ACCESS_POLICY (e.g.
  // END_USER_ACCOUNT_MANAGEMENT, "Okta Account Management Policy") does NOT contribute phantom app
  // rules. Unlike the node loop, SYSTEM policies are KEPT here: the org-default's rules are the source
  // of its strength band (Phase 0), even though the policy itself isn't a managed node.
  const appTypedPolicyIds = new Set(
    snapshot.appAuthPolicies
      .filter((p) => {
        const rt = p._embedded?.resourceType;
        return rt == null || rt === "APP";
      })
      .map((p) => p.id),
  );
  for (const [policyId, rules] of Object.entries(snapshot.policyRules ?? {})) {
    if (!appTypedPolicyIds.has(policyId)) continue;
    for (const rule of rules) {
      const appSignOn = rule.actions?.appSignOn;
      const vm = appSignOn?.verificationMethod;
      const constraints = Array.isArray(vm?.constraints) ? vm.constraints.map(toRuleConstraint) : [];
      const groups = rule.conditions?.people?.groups?.include ?? [];
      out.push({
        kind: "AppAuthPolicyRule",
        id: rule.id,
        policyId,
        name: rule.name,
        address: `okta-api:app_signon_policy_rule/${policyId}/${rule.id}`,
        priority: rule.priority,
        status: rule.status || undefined,
        system: rule.system === true || undefined,
        // Flag the org-default (system) policy's rules so Phase C can band a null-policy app: the
        // org-default is never a node, so this is the only carried signal of which policy it is.
        policySystem: systemPolicyIds.has(policyId) || undefined,
        access: appSignOn?.access ?? "",
        factorMode: vm?.factorMode || undefined,
        assuranceType: vm?.type || undefined,
        reauthenticateIn: vm?.reauthenticateIn || undefined,
        constraints,
        groupsIncluded: groups.length > 0 ? groups : undefined,
        networkConnection: rule.conditions?.network?.connection || undefined,
      });
    }
  }

  for (const [appId, rows] of Object.entries(snapshot.appGroupAssignments)) {
    for (const row of rows) {
      out.push({
        kind: "AppGroupAssignment",
        address: `okta-api:app_group_assignment/${appId}/${row.id}`,
        appId,
        groupId: row.id,
      });
    }
  }

  return out;
}
