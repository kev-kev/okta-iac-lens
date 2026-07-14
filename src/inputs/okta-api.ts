/**
 * inputs/okta-api: read-only live Okta tenant reader.
 *
 * This is the I/O boundary for M2, same role as `tfstate-file.ts` for M1: `src/core/`
 * (and the pure mapper in `map-api.ts`) never touch the network directly. This file
 * owns HTTP, pagination, and credentials; it returns RAW API JSON, already typed to
 * the documented response shapes. Turning that raw JSON into `ParsedResource[]` is
 * `map-api.ts`'s job, not this file's.
 *
 * Scopes: this reader only ever calls read endpoints (`okta.groups.read`,
 * `okta.apps.read`, `okta.policies.read`). It must never call a write/mutating
 * endpoint. There is no code path here that does.
 *
 * The `HttpOktaReader` constructor does NOT make any network call — it only stores
 * config. Every method call is a live request. No live request has been exercised
 * yet; that's Phase B (needs a real tenant).
 */

/** Minimal, defensive view of the live API shapes we touch (mirrors parse-tfstate's RawResource). */
export interface RawGroup {
  id: string;
  /** OKTA_GROUP (customer-managed) | BUILT_IN (Everyone, Okta Administrators) | APP_GROUP (app-mastered). Only OKTA_GROUP is Terraform-manageable. */
  type?: string;
  profile?: { name?: string; description?: string };
}

export interface RawApp {
  id: string;
  /** Catalog key, e.g. "github" — NOT the display name. Display name is `label`. */
  name: string;
  label: string;
  status?: string;
  /** e.g. "SAML_2_0", "OPENID_CONNECT", "AUTO_LOGIN". Stands in for the tfstate `okta_app_*` type. */
  signOnMode?: string;
  _links?: {
    /** Every app has this link, even when using the org's default access policy. */
    accessPolicy?: { href?: string };
  };
}

export interface RawGroupRule {
  id: string;
  name: string;
  status?: string;
  conditions?: {
    expression?: { type?: string; value?: string };
  };
  actions?: {
    assignUserToGroups?: { groupIds?: string[] };
  };
}

/** Shared shape for both `OKTA_SIGN_ON` (global session) and `ACCESS_POLICY` (app auth) policies. */
export interface RawPolicy {
  id: string;
  type: string;
  name: string;
  status?: string;
  /** Evaluation priority (lower = evaluated first). Present on OKTA_SIGN_ON + ACCESS_POLICY policies. */
  priority?: number;
  /**
   * true = Okta-managed built-in. Verified live: a fresh tenant's org-default
   * ACCESS_POLICY ("Any two factors") is the only `system: true` one. The mapper
   * uses this to translate "app points at a system policy" into "org default".
   */
  system?: boolean;
  conditions?: {
    people?: { groups?: { include?: string[] } };
  };
  /**
   * For ACCESS_POLICY: the policy's target resource type, e.g. "APP" vs
   * "END_USER_ACCOUNT_MANAGEMENT". Only APP policies are app sign-on policies. Verified
   * live: `type=ACCESS_POLICY` returns a non-app "Okta Account Management Policy" carrying
   * resourceType END_USER_ACCOUNT_MANAGEMENT. The mapper emits AppAuthPolicy nodes for
   * APP-typed policies only (a MISSING resourceType is treated as APP).
   */
  _embedded?: { resourceType?: string };
}

/** One row of `GET /api/v1/apps/{appId}/groups` — the live, all-groups-for-this-app read. */
export interface RawAppGroupAssignment {
  id: string; // group id
  priority?: number;
}

/** Minimal view of `GET /api/v1/users/{idOrLogin}`. Only `id` + login are used; the rest is PII we don't read. */
export interface RawUser {
  id: string;
  profile?: { login?: string; email?: string };
}

/**
 * Narrow read-only interface. `map-api.ts` and tests depend on this, not on
 * `HttpOktaReader` directly, so fixtures can implement it with zero network.
 */
export interface OktaReader {
  listGroups(): Promise<RawGroup[]>;
  listApps(): Promise<RawApp[]>;
  listGroupRules(): Promise<RawGroupRule[]>;
  /** `GET /api/v1/policies?type=OKTA_SIGN_ON` */
  listGlobalSessionPolicies(): Promise<RawPolicy[]>;
  /** `GET /api/v1/policies?type=ACCESS_POLICY` */
  listAppAuthPolicies(): Promise<RawPolicy[]>;
  /** `GET /api/v1/apps/{appId}/groups` — all groups currently assigned to this app. */
  listAppGroupAssignments(appId: string): Promise<RawAppGroupAssignment[]>;
}

/**
 * User-lookup reads for the per-user trace. Deliberately SEPARATE from `OktaReader` (the
 * whole-tenant snapshot): user trace looks up ONE user at a time, so snapshot fixtures don't
 * implement these, and this stays a distinct, narrowly-scoped read surface. Read-only.
 */
export interface OktaUserReader {
  /** `GET /api/v1/users/{idOrLogin}` — resolve an email/login to a user. */
  getUserByLogin(login: string): Promise<RawUser>;
  /** `GET /api/v1/users/{userId}/groups` — the group ids this user belongs to. */
  listUserGroupIds(userId: string): Promise<string[]>;
}

export interface OktaReaderConfig {
  orgUrl: string;
  apiToken: string;
}

/**
 * Everything the live API gives us for one tenant, fetched once. This is the input
 * contract for the pure mapper (`map-api.ts`) — the API-side analogue of the parsed
 * tfstate JSON object. Tests build these from `fixtures/api/*.json` with zero network.
 */
export interface OktaApiSnapshot {
  groups: RawGroup[];
  apps: RawApp[];
  groupRules: RawGroupRule[];
  globalSessionPolicies: RawPolicy[];
  appAuthPolicies: RawPolicy[];
  /** Per-app group assignments, keyed by app id (`GET /api/v1/apps/{id}/groups`). */
  appGroupAssignments: Record<string, RawAppGroupAssignment[]>;
}

/**
 * Fetch a full tenant snapshot. The independent lists go out in parallel; the
 * per-app group reads run sequentially to stay well under Integrator-tenant
 * rate limits.
 */
export async function readTenantSnapshot(reader: OktaReader): Promise<OktaApiSnapshot> {
  const [groups, apps, groupRules, globalSessionPolicies, appAuthPolicies] =
    await Promise.all([
      reader.listGroups(),
      reader.listApps(),
      reader.listGroupRules(),
      reader.listGlobalSessionPolicies(),
      reader.listAppAuthPolicies(),
    ]);
  const appGroupAssignments: Record<string, RawAppGroupAssignment[]> = {};
  for (const app of apps) {
    appGroupAssignments[app.id] = await reader.listAppGroupAssignments(app.id);
  }
  return { groups, apps, groupRules, globalSessionPolicies, appAuthPolicies, appGroupAssignments };
}

/** Read live-reader config from env vars. Throws with a clear, actionable message if unset. */
export function readOktaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OktaReaderConfig {
  const orgUrl = env.OKTA_ORG_URL;
  const apiToken = env.OKTA_API_TOKEN;
  if (!orgUrl || !apiToken) {
    throw new Error(
      "Live Okta mode requires OKTA_ORG_URL and OKTA_API_TOKEN to be set (see .env.example). " +
        "Both must be read-only credentials scoped to okta.groups.read, okta.apps.read, " +
        "okta.policies.read (plus okta.users.read for `trace --user`).",
    );
  }
  return { orgUrl, apiToken };
}

/** Parse `rel="next"` out of an Okta `Link` response header, per RFC 5988. */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Live, read-only HTTP client. Construction does NOT call the network — only
 * `list*` methods do, and only when invoked (Phase B).
 */
export class HttpOktaReader implements OktaReader, OktaUserReader {
  constructor(private readonly config: OktaReaderConfig) {}

  /** One read request. Shared header/error handling; returns the parsed Response for the caller. */
  private async get(path: string): Promise<Response> {
    const url = new URL(path, this.config.orgUrl).toString();
    const res = await fetch(url, {
      headers: {
        Authorization: `SSWS ${this.config.apiToken}`,
        Accept: "application/json",
      },
    });
    return res;
  }

  private async getPaginated<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = new URL(path, this.config.orgUrl).toString();
    while (url) {
      const res: Response = await fetch(url, {
        headers: {
          Authorization: `SSWS ${this.config.apiToken}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`Okta API request failed: GET ${url} -> ${res.status} ${res.statusText}`);
      }
      const page = (await res.json()) as T[];
      out.push(...page);
      url = parseNextLink(res.headers.get("link"));
    }
    return out;
  }

  async getUserByLogin(login: string): Promise<RawUser> {
    // Okta accepts a login/email in the id path segment; encode it (emails contain no slashes
    // but may contain '+', '@', etc.).
    const res = await this.get(`/api/v1/users/${encodeURIComponent(login)}`);
    if (res.status === 404) {
      throw new Error(`User not found: "${login}"`);
    }
    if (!res.ok) {
      throw new Error(
        `Okta API request failed: GET /api/v1/users/${login} -> ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as RawUser;
  }

  async listUserGroupIds(userId: string): Promise<string[]> {
    const groups = await this.getPaginated<{ id: string }>(
      `/api/v1/users/${encodeURIComponent(userId)}/groups`,
    );
    return groups.map((g) => g.id);
  }

  listGroups(): Promise<RawGroup[]> {
    return this.getPaginated<RawGroup>("/api/v1/groups");
  }

  listApps(): Promise<RawApp[]> {
    return this.getPaginated<RawApp>("/api/v1/apps");
  }

  listGroupRules(): Promise<RawGroupRule[]> {
    return this.getPaginated<RawGroupRule>("/api/v1/groups/rules");
  }

  listGlobalSessionPolicies(): Promise<RawPolicy[]> {
    return this.getPaginated<RawPolicy>("/api/v1/policies?type=OKTA_SIGN_ON");
  }

  listAppAuthPolicies(): Promise<RawPolicy[]> {
    return this.getPaginated<RawPolicy>("/api/v1/policies?type=ACCESS_POLICY");
  }

  listAppGroupAssignments(appId: string): Promise<RawAppGroupAssignment[]> {
    return this.getPaginated<RawAppGroupAssignment>(`/api/v1/apps/${appId}/groups`);
  }
}
