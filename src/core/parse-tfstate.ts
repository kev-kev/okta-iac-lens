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
  | { kind: "AppGroupAssignment"; address: string; appId: string; groupId: string }
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
          if (groupId) records.push({ kind: "AppGroupAssignment", address, appId, groupId });
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
