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
  | { kind: "Group"; id: string; name: string; address: string }
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
    }
  | {
      kind: "GlobalSessionPolicy";
      id: string;
      name: string;
      address: string;
      /** Group ids the policy applies to (`values.groups_included`); unordered set. */
      groupsIncluded: string[];
    }
  | { kind: "AppAuthPolicy"; id: string; name: string; address: string }
  | { kind: "AppGroupAssignment"; address: string; appId: string; groupId: string };

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
 * App resource types are `okta_app_*`, EXCEPT these lookalikes which are handled
 * as their own kinds (or, for the plural assignment, deferred to M2).
 */
const APP_TYPE_DENYLIST = new Set([
  "okta_app_group_assignment",
  "okta_app_group_assignments",
  "okta_app_signon_policy",
  "okta_app_signon_policy_rule",
]);

function isAppType(type: string): boolean {
  return type.startsWith("okta_app_") && !APP_TYPE_DENYLIST.has(type);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
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

function normalizeResource(r: RawResource): ParsedResource | null {
  if (r.mode === "data") return null; // ignore data sources; managed resources only
  const type = r.type ?? "";
  const values = r.values ?? {};
  const address = r.address ?? "";
  const id = str(values.id);

  switch (type) {
    case "okta_group":
      return { kind: "Group", id, name: str(values.name), address };

    case "okta_group_rule":
      return {
        kind: "GroupRule",
        id,
        name: str(values.name),
        address,
        expression: str(values.expression_value),
        expressionType: str(values.expression_type) || undefined,
        populates: strArray(values.group_assignments),
      };

    case "okta_policy_signon":
      return {
        kind: "GlobalSessionPolicy",
        id,
        name: str(values.name),
        address,
        groupsIncluded: strArray(values.groups_included),
      };

    case "okta_app_signon_policy":
      return { kind: "AppAuthPolicy", id, name: str(values.name), address };

    case "okta_app_group_assignment":
      return {
        kind: "AppGroupAssignment",
        address,
        appId: str(values.app_id),
        groupId: str(values.group_id),
      };

    case "okta_app_group_assignments":
      // Plural form (all-groups read + dynamic `group` blocks). Deferred to M2, where
      // it will be validated against a real export. M1 handles the singular form only.
      return null;

    default: {
      if (!isAppType(type)) return null;
      const authPolicy = values.authentication_policy;
      return {
        kind: "App",
        id,
        name: str(values.label),
        appType: type,
        address,
        authenticationPolicyId:
          typeof authPolicy === "string" && authPolicy.length > 0 ? authPolicy : null,
      };
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
    const normalized = normalizeResource(raw);
    if (normalized) out.push(normalized);
  }
  return out;
}
