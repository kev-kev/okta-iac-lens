/**
 * parse-tfstate: `terraform show -json` (state) -> normalized resource records.
 *
 * PURE. No file I/O, no network. Input is the already-parsed JSON object; output is
 * a flat list of the Okta resources we care about, one tagged record per resource.
 * build-graph turns these into nodes + edges.
 *
 * We read STATE json (resolved concrete ids in `values`), not plan json. We recurse
 * through `child_modules` so a resource's module nesting doesn't change the result.
 */

/**
 * One normalized authenticator-class constraint — one element of an app-auth policy rule's
 * `constraints`. The two capture paths encode these DIFFERENTLY (Phase 0 asymmetry (b)):
 *   - live  `actions.appSignOn.verificationMethod.constraints[]` — NESTED OBJECTS.
 *   - tfstate `values.constraints` — a List of String, each a `jsonencode()`'d object.
 * Both are normalized to THIS shape. Only the strength-relevant fields are kept: a possession
 * `phishingResistant`/`hardwareProtection` = "REQUIRED" is what promotes a 2FA rule to the
 * phishing-resistant band in `policy-strength.ts` (M15 Phase B).
 */
export interface RuleConstraint {
  knowledge?: { required?: boolean; types?: string[] };
  possession?: {
    required?: boolean;
    deviceBound?: string;
    hardwareProtection?: string;
    phishingResistant?: string;
  };
}

/** A normalized resource record — a tagged union build-graph can switch on. */
export type ParsedResource =
  | {
      kind: "Group";
      id: string;
      name: string;
      address: string;
      /** Live-only: API group `type` (OKTA_GROUP | BUILT_IN | APP_GROUP). Unset on the tfstate path. */
      groupType?: string;
    }
  | {
      kind: "App";
      id: string;
      /** Human-facing name, sourced from `values.label` (NOT `values.name`, which is the app-type slug). */
      name: string;
      /** The Terraform resource type, e.g. "okta_app_oauth". */
      appType: string;
      address: string;
      /** App sign-on policy id from `values.authentication_policy`; null => org default policy. */
      authenticationPolicyId: string | null;
      /** Okta lifecycle status (`ACTIVE`|`INACTIVE`); undefined on fixtures that omit it => ACTIVE. */
      status?: string;
      /**
       * Live-only: the catalog slug (`RawApp.name`, e.g. "oidc_client"), NOT the display `name`
       * (which is `label`). Carried through from `map-api` for the built-in-app exclusion
       * contingency (PLAN.md); unset on the tfstate path, mirroring `groupType`.
       */
      catalogName?: string;
    }
  | {
      kind: "GroupRule";
      id: string;
      name: string;
      address: string;
      /** Raw OEL string, stored literally, never evaluated in M1. */
      expression: string;
      expressionType?: string;
      /** Target group ids this rule populates (`values.group_assignments`). */
      populates: string[];
      /** Okta lifecycle status (`ACTIVE`|`INACTIVE`); undefined => ACTIVE. INACTIVE => populates no one. */
      status?: string;
    }
  | {
      kind: "GlobalSessionPolicy";
      id: string;
      name: string;
      address: string;
      /** Group ids the policy applies to (`values.groups_included`); unordered set. */
      groupsIncluded: string[];
      /** Live-only: true for Okta's built-in system policies. Unset on the tfstate path. */
      system?: boolean;
      /** Evaluation priority (`values.priority`); lower = first. undefined => sorts last. */
      priority?: number;
      /** Okta lifecycle status (`ACTIVE`|`INACTIVE`); undefined => ACTIVE. */
      status?: string;
    }
  | {
      kind: "AppAuthPolicy";
      id: string;
      name: string;
      address: string;
      /** Evaluation priority; carried for M15. undefined => sorts last. */
      priority?: number;
      /** Okta lifecycle status; undefined => ACTIVE. */
      status?: string;
    }
  /**
   * One rule of an app auth policy (`okta_app_signon_policy_rule` / live `GET /policies/{id}/rules`).
   * NOT a graph node — rules are policy-internal (see model.ts `NodeKind`); captured so M15's
   * strength model (`policy-strength.ts`, Phase B) can derive a policy's band from its rules'
   * CONTENTS, not just which policy applies. The two paths normalize to this ONE shape despite
   * differing encodings (Phase 0 findings): `access`/`factorMode`/`assuranceType`/`reauthenticateIn`
   * are top-level snake_case in tfstate but nested under `actions.appSignOn(.verificationMethod)`
   * live; `constraints` is a JSON-string list (tfstate) vs nested objects (live). The Okta
   * auto-created catch-all rule is `system: true` and returned LIVE but ABSENT from tfstate
   * (unmanaged) — the one documented tfstate/live rule asymmetry, not a bug.
   */
  | {
      kind: "AppAuthPolicyRule";
      id: string;
      /** The policy this rule belongs to (tfstate `policy_id` / the live capture's map key). */
      policyId: string;
      name: string;
      address: string;
      /** Evaluation priority (lower = first). The system catch-all is always the highest number. */
      priority?: number;
      /** Okta lifecycle status (`ACTIVE`|`INACTIVE`); undefined => ACTIVE. INACTIVE => excluded from the band (M12 rule). */
      status?: string;
      /** true = Okta's built-in catch-all rule. Live-only (the catch-all is unmanaged, absent from tfstate). */
      system?: boolean;
      /**
       * true = this rule's POLICY is the org-default (`system: true`) app-auth policy — the one apps
       * fall back to when they carry no custom `protects` edge (`authenticationPolicyId: null`). The
       * org-default policy is never a graph node, so this per-rule flag is the ONLY channel that lets
       * Phase C resolve a null-policy app to its band (`orgDefaultPolicyId` in policy-strength).
       * Live-only: tfstate has no system policy, so a null-policy app stays `unknown` there (the
       * documented Phase 0 divergence). Distinct from `system` above, which flags the catch-all RULE.
       */
      policySystem?: boolean;
      /** `ALLOW` | `DENY`. DENY is recorded as evidence but does NOT set the weakest-ALLOW floor (Phase 0 D1). */
      access: string;
      /** `1FA` | `2FA` | `2FA_If_Possible` | … Kept LITERAL; the strength model classifies, never guesses. */
      factorMode?: string;
      /** Verification `type`, e.g. `ASSURANCE` (tfstate `type` / live `verificationMethod.type`). */
      assuranceType?: string;
      /** Re-auth frequency, ISO-8601 (tfstate `re_authentication_frequency` / live `reauthenticateIn`). */
      reauthenticateIn?: string;
      /** Authenticator-class constraints, normalized from both encodings (empty when the rule has none). */
      constraints: RuleConstraint[];
      /** Group ids the rule is scoped to (tfstate `groups_included` / live `conditions.people.groups.include`); carried so Phase C evidence stays honest about SCOPE. */
      groupsIncluded?: string[];
      /** Network scope (e.g. `ANYWHERE`|`ZONE`); evidence-scope, like `groupsIncluded`. */
      networkConnection?: string;
    }
  | {
      kind: "AppGroupAssignment";
      address: string;
      appId: string;
      groupId: string;
      /**
       * Live-only-analogue provenance: set (only) when this pair came from the PLURAL
       * `okta_app_group_assignments` resource. That resource re-reads ALL groups assigned to
       * the app from the API on every refresh (the CLAUDE.md provider gotcha), so a click-ops
       * assignment gets absorbed into state and would be reported `managed` — a silent 100%.
       * Coverage carries this flag through so every surface can caveat "absorbs click-ops drift".
       * Unset on the singular `okta_app_group_assignment` arm.
       */
      viaPluralResource?: true;
    }
  /**
   * Individual user -> app assignment (`okta_app_user`). NOT a graph node/edge — a user is never
   * a graph node (see model.ts / CLAUDE.md scale rule). Captured so it is COUNTED (coverage +
   * summary notice), never silently dropped. The per-user trace inclusion is M13's scope check.
   */
  | { kind: "AppUserAssignment"; address: string; appId: string; userId: string }
  /**
   * Standalone access-policy attachment (`okta_app_access_policy_assignment`; app_id + policy_id).
   * The SECOND way an app gets a `protects` edge, besides the inline `authentication_policy`
   * attribute. Confirmed present in okta/okta v4.20.0 (M11 Phase A).
   */
  | { kind: "AppAccessPolicyAssignment"; address: string; appId: string; policyId: string };

/**
 * The `AppAuthPolicyRule` variant, named for the modules that consume rules directly (the strength
 * model; the envelope's `policyRules` carrier — M15 Phase D). Rules are policy-internal, never a
 * graph node, so they travel as this `ParsedResource` subset rather than inside `OktaGraph`.
 */
export type AppAuthPolicyRule = Extract<ParsedResource, { kind: "AppAuthPolicyRule" }>;

/** Minimal, defensive view of the tfstate shapes we touch. */
interface RawResource {
  address?: string;
  mode?: string;
  type?: string;
  name?: string;
  values?: Record<string, unknown>;
}
interface RawModule {
  resources?: RawResource[];
  child_modules?: RawModule[];
}
interface RawState {
  values?: { root_module?: RawModule };
}

/**
 * The complete set of okta/okta v4.20.0 `okta_app_*` resources that are actual APPLICATION
 * objects (→ `App` nodes). This is an ALLOWLIST, not a denylist: the M11 fact table found 9
 * NON-APP `okta_app_*` lookalikes (okta_app_user, okta_app_access_policy_assignment, the schema
 * and oauth-config sub-resources, ...) that a narrow denylist let through as junk App nodes.
 * Anything not in this set is handled by an explicit case below or ignored.
 * Only affects the tfstate path — `map-api` emits `App` records directly.
 */
const APP_TYPE_ALLOWLIST = new Set([
  "okta_app_auto_login",
  "okta_app_basic_auth",
  "okta_app_bookmark",
  "okta_app_oauth",
  "okta_app_saml",
  "okta_app_secure_password_store",
  "okta_app_shared_credentials",
  "okta_app_swa",
  "okta_app_three_field",
]);

function isAppType(type: string): boolean {
  return APP_TYPE_ALLOWLIST.has(type);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** `values.priority` as a number, or undefined if absent/non-numeric (=> sorts last). */
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Project an already-parsed constraint object (from either path) onto the strength-relevant
 * `RuleConstraint` shape. Defensive: an input that isn't an object, or is missing a class, yields
 * an empty/partial constraint — never throws. Shared by the tfstate parser (post-JSON.parse) and
 * the live mapper so both paths land on ONE normal form (the equivalence oracle depends on it).
 */
export function toRuleConstraint(raw: unknown): RuleConstraint {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as { knowledge?: unknown; possession?: unknown };
  const out: RuleConstraint = {};
  if (o.knowledge && typeof o.knowledge === "object") {
    const k = o.knowledge as { required?: unknown; types?: unknown };
    const knowledge: NonNullable<RuleConstraint["knowledge"]> = {};
    if (typeof k.required === "boolean") knowledge.required = k.required;
    if (Array.isArray(k.types)) knowledge.types = k.types.filter((t): t is string => typeof t === "string");
    out.knowledge = knowledge;
  }
  if (o.possession && typeof o.possession === "object") {
    const p = o.possession as Record<string, unknown>;
    const possession: NonNullable<RuleConstraint["possession"]> = {};
    if (typeof p.required === "boolean") possession.required = p.required;
    if (typeof p.deviceBound === "string") possession.deviceBound = p.deviceBound;
    if (typeof p.hardwareProtection === "string") possession.hardwareProtection = p.hardwareProtection;
    if (typeof p.phishingResistant === "string") possession.phishingResistant = p.phishingResistant;
    out.possession = possession;
  }
  return out;
}

/**
 * tfstate `constraints` (List of String, each a `jsonencode()`'d object) -> `RuleConstraint[]`.
 * A malformed element is SKIPPED rather than throwing — the parser must not crash on a shape it
 * can't read; the strength model treats an unclassifiable rule as `unknown`, never a guess.
 */
function parseConstraintStrings(v: unknown): RuleConstraint[] {
  if (!Array.isArray(v)) return [];
  const out: RuleConstraint[] = [];
  for (const el of v) {
    if (typeof el !== "string") continue;
    try {
      out.push(toRuleConstraint(JSON.parse(el)));
    } catch {
      // Unparseable constraint string — skip it rather than crash the whole parse.
    }
  }
  return out;
}

/** Depth-first collect of every resource across root + nested child modules, in a stable order. */
function collectResources(mod: RawModule): RawResource[] {
  const here = mod.resources ?? [];
  const nested = (mod.child_modules ?? []).flatMap(collectResources);
  return [...here, ...nested];
}

function normalizeResource(r: RawResource): ParsedResource[] {
  if (r.mode === "data") return []; // ignore data sources; managed resources only
  const type = r.type ?? "";
  const values = r.values ?? {};
  const address = r.address ?? "";
  const id = str(values.id);

  switch (type) {
    case "okta_group":
      // groupType is a live-only concern (API `type`); tfstate groups are always
      // customer-managed, so it stays unset here.
      return [{ kind: "Group", id, name: str(values.name), address }];

    case "okta_group_rule":
      return [
        {
          kind: "GroupRule",
          id,
          name: str(values.name),
          address,
          expression: str(values.expression_value),
          expressionType: str(values.expression_type) || undefined,
          populates: strArray(values.group_assignments),
          status: str(values.status) || undefined,
        },
      ];

    case "okta_policy_signon":
      // `system` is a live-only concern; tfstate policies are customer-managed, unset here.
      return [
        {
          kind: "GlobalSessionPolicy",
          id,
          name: str(values.name),
          address,
          groupsIncluded: strArray(values.groups_included),
          priority: num(values.priority),
          status: str(values.status) || undefined,
        },
      ];

    case "okta_app_signon_policy":
      return [
        {
          kind: "AppAuthPolicy",
          id,
          name: str(values.name),
          address,
          priority: num(values.priority),
          status: str(values.status) || undefined,
        },
      ];

    case "okta_app_signon_policy_rule": {
      const groups = strArray(values.groups_included);
      return [
        {
          kind: "AppAuthPolicyRule",
          id,
          policyId: str(values.policy_id),
          name: str(values.name),
          address,
          priority: num(values.priority),
          status: str(values.status) || undefined,
          // The catch-all is unmanaged (never in tfstate), but carry `system` faithfully if present.
          system: values.system === true || undefined,
          access: str(values.access),
          factorMode: str(values.factor_mode) || undefined,
          assuranceType: str(values.type) || undefined,
          reauthenticateIn: str(values.re_authentication_frequency) || undefined,
          constraints: parseConstraintStrings(values.constraints),
          groupsIncluded: groups.length > 0 ? groups : undefined,
          networkConnection: str(values.network_connection) || undefined,
        },
      ];
    }

    case "okta_app_user":
      return [
        {
          kind: "AppUserAssignment",
          address,
          appId: str(values.app_id),
          userId: str(values.user_id) || str(values.id),
        },
      ];

    case "okta_app_access_policy_assignment":
      return [
        {
          kind: "AppAccessPolicyAssignment",
          address,
          appId: str(values.app_id),
          policyId: str(values.policy_id),
        },
      ];

    case "okta_app_group_assignment":
      return [
        {
          kind: "AppGroupAssignment",
          address,
          appId: str(values.app_id),
          groupId: str(values.group_id),
        },
      ];

    case "okta_app_group_assignments": {
      // Plural form: one `app_id` + a `group` block list (each block has `id`, plus
      // optional `priority`/`profile`). Confirmed against okta/okta v4.20.0 (see PLAN.md
      // step-1 findings). In `terraform show -json`, `values.group` is an array; emit one
      // AppGroupAssignment per block — the state-side analogue of the live all-groups read.
      const appId = str(values.app_id);
      const groups: unknown[] = Array.isArray(values.group) ? values.group : [];
      const records: ParsedResource[] = [];
      for (const g of groups) {
        if (g && typeof g === "object") {
          const groupId = str((g as { id?: unknown }).id);
          if (groupId)
            records.push({
              kind: "AppGroupAssignment",
              address,
              appId,
              groupId,
              viaPluralResource: true,
            });
        }
      }
      return records;
    }

    default: {
      if (!isAppType(type)) return [];
      const authPolicy = values.authentication_policy;
      return [
        {
          kind: "App",
          id,
          name: str(values.label),
          appType: type,
          address,
          authenticationPolicyId:
            typeof authPolicy === "string" && authPolicy.length > 0 ? authPolicy : null,
          status: str(values.status) || undefined,
        },
      ];
    }
  }
}

/** Parse a `terraform show -json` state object into normalized resource records. */
export function parseTfState(state: unknown): ParsedResource[] {
  const root = (state as RawState)?.values?.root_module;
  if (!root) {
    throw new Error("Unexpected tfstate shape: missing `values.root_module`.");
  }
  const out: ParsedResource[] = [];
  for (const raw of collectResources(root)) {
    out.push(...normalizeResource(raw));
  }
  return out;
}
