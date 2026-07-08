/**
 * server/api: the transport-agnostic request handler for the M9 local read-only API.
 *
 * The browser talks to this over localhost; this handler talks to Okta with the SSWS token, which
 * lives ONLY here (server-side) and is never returned or logged. It is deliberately transport-free
 * — `handleApiRequest` takes a plain `ApiRequest` and injected `ApiDeps`, so it's unit-tested with a
 * fake reader (no sockets, no network). The Vite dev-server middleware (`vite.config.ts`) is the
 * only place that binds it to real HTTP.
 *
 * SECURITY (the crux of M9): this endpoint exposes read-only tenant data on localhost, so a
 * malicious web page you visit could try to reach it through your browser. Defenses:
 *  - GET-only, read-only (no path mutates anything; the Okta client only calls GET endpoints).
 *  - Host allowlist — reject unless the Host header is a loopback name. Blocks DNS-rebinding (a
 *    rebind still sends `Host: attacker.com`).
 *  - Origin check — if an Origin header is present it must be loopback too. Blocks cross-site reads.
 */

import type { UserRef } from "../core/access-paths.js";
import type { GraphEnvelope } from "../render/envelope.js";

export interface ApiRequest {
  method: string;
  /** URL pathname, e.g. "/api/user-membership". */
  path: string;
  query: URLSearchParams;
  headers: { host?: string; origin?: string };
}

export interface ApiResponse {
  status: number;
  json: unknown;
}

export interface ApiDeps {
  /** Whether live Okta credentials are configured. When false, live endpoints return 503. */
  live: boolean;
  /** Resolve one login → membership (the token-holding lookup). */
  loadMembership: (login: string) => Promise<{ user: UserRef; groupIds: string[] }>;
  /** Build a live graph envelope for the viewer. */
  loadEnvelope: () => Promise<GraphEnvelope>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Extract the host (no port) from a `Host` header value: "localhost:5173" → "localhost". */
function hostOfHeader(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1); // IPv6 "[::1]:port"
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

function isLoopbackHostHeader(host: string | undefined): boolean {
  return host != null && LOOPBACK_HOSTS.has(hostOfHeader(host));
}

/** An Origin, when present, must be a loopback origin. Absent (same-origin GET) is allowed. */
function isOriginAllowed(origin: string | undefined): boolean {
  if (origin == null || origin === "" || origin === "null") return origin !== "null";
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Security gate shared by every route. Returns a blocking response, or null to proceed. */
function guard(req: ApiRequest): ApiResponse | null {
  if (req.method !== "GET") return { status: 405, json: { error: "Only GET is supported." } };
  if (!isLoopbackHostHeader(req.headers.host)) {
    return { status: 403, json: { error: "Forbidden: non-loopback Host." } };
  }
  if (!isOriginAllowed(req.headers.origin)) {
    return { status: 403, json: { error: "Forbidden: cross-origin request." } };
  }
  return null;
}

/**
 * Handle one API request. Pure of transport: the caller adapts real HTTP (or a test) into
 * `ApiRequest` and renders `ApiResponse`. Never includes the SSWS token in any response.
 */
export async function handleApiRequest(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const blocked = guard(req);
  if (blocked) return blocked;

  // Health is the viewer's live-mode probe — reports whether live creds are configured.
  if (req.path === "/api/health") {
    return { status: 200, json: { live: deps.live, source: "okta" } };
  }

  if (!deps.live) {
    return {
      status: 503,
      json: { error: "Live mode unavailable: set OKTA_ORG_URL and OKTA_API_TOKEN (see .env.example)." },
    };
  }

  if (req.path === "/api/graph") {
    return { status: 200, json: await deps.loadEnvelope() };
  }

  if (req.path === "/api/user-membership") {
    const login = req.query.get("login");
    if (!login) return { status: 400, json: { error: "Missing required query param: login." } };
    try {
      return { status: 200, json: await deps.loadMembership(login) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(msg)) return { status: 404, json: { error: msg } };
      if (/OKTA_ORG_URL|OKTA_API_TOKEN/.test(msg)) return { status: 503, json: { error: msg } };
      return { status: 500, json: { error: msg } };
    }
  }

  return { status: 404, json: { error: `Unknown route: ${req.path}` } };
}
