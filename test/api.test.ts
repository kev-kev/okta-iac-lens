/**
 * M9 local API handler — the security gate + read-only routes, tested transport-free with injected
 * deps (no sockets, no network). The SSWS token never appears here; deps stand in for the live read.
 */

import { describe, expect, it } from "vitest";
import { handleApiRequest, type ApiDeps, type ApiRequest } from "../src/server/api.js";
import { makeEnvelope } from "../src/render/envelope.js";
import { graphFromFixture } from "./fixture.js";

const OK_HEADERS = { host: "localhost:5173" }; // loopback, no Origin (same-origin GET)

function req(partial: Partial<ApiRequest>): ApiRequest {
  return {
    method: "GET",
    path: "/api/health",
    query: new URLSearchParams(),
    headers: OK_HEADERS,
    ...partial,
  };
}

const liveDeps: ApiDeps = {
  live: true,
  loadMembership: async (login) => {
    if (login === "ghost@example.com") throw new Error(`User not found: "${login}"`);
    return { user: { id: "u-alice", login }, groupIds: ["g-eng", "g-con"] };
  },
  loadEnvelope: async () => makeEnvelope(graphFromFixture(), "okta", "2026-07-08T00:00:00.000Z"),
};

const offlineDeps: ApiDeps = {
  live: false,
  loadMembership: async () => { throw new Error("should not be called"); },
  loadEnvelope: async () => { throw new Error("should not be called"); },
};

describe("handleApiRequest — security gate", () => {
  it("rejects a non-loopback Host header (DNS-rebinding defense) with 403", async () => {
    const res = await handleApiRequest(req({ headers: { host: "evil.com:5173" } }), liveDeps);
    expect(res.status).toBe(403);
  });

  it("rejects a cross-site Origin with 403", async () => {
    const res = await handleApiRequest(
      req({ path: "/api/user-membership", query: new URLSearchParams({ login: "a@b.com" }), headers: { host: "localhost:5173", origin: "https://evil.com" } }),
      liveDeps,
    );
    expect(res.status).toBe(403);
  });

  it("allows a loopback Origin", async () => {
    const res = await handleApiRequest(
      req({ headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" } }),
      liveDeps,
    );
    expect(res.status).toBe(200);
  });

  it("rejects non-GET methods with 405", async () => {
    const res = await handleApiRequest(req({ method: "POST" }), liveDeps);
    expect(res.status).toBe(405);
  });
});

describe("handleApiRequest — routes", () => {
  it("health reports live status without needing creds", async () => {
    expect((await handleApiRequest(req({}), liveDeps)).json).toEqual({ live: true, source: "okta" });
    expect((await handleApiRequest(req({}), offlineDeps)).json).toEqual({ live: false, source: "okta" });
  });

  it("user-membership returns {user, groupIds} for a known login", async () => {
    const res = await handleApiRequest(
      req({ path: "/api/user-membership", query: new URLSearchParams({ login: "alice@example.com" }) }),
      liveDeps,
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ user: { id: "u-alice", login: "alice@example.com" }, groupIds: ["g-eng", "g-con"] });
  });

  it("user-membership 400s on a missing login", async () => {
    const res = await handleApiRequest(req({ path: "/api/user-membership" }), liveDeps);
    expect(res.status).toBe(400);
  });

  it("user-membership 404s on an unknown login", async () => {
    const res = await handleApiRequest(
      req({ path: "/api/user-membership", query: new URLSearchParams({ login: "ghost@example.com" }) }),
      liveDeps,
    );
    expect(res.status).toBe(404);
  });

  it("graph returns a live envelope", async () => {
    const res = await handleApiRequest(req({ path: "/api/graph" }), liveDeps);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ version: 1, source: "okta" });
  });

  it("live routes 503 when creds are absent (graph + membership), but health still answers", async () => {
    expect((await handleApiRequest(req({ path: "/api/graph" }), offlineDeps)).status).toBe(503);
    expect(
      (await handleApiRequest(req({ path: "/api/user-membership", query: new URLSearchParams({ login: "a@b.com" }) }), offlineDeps)).status,
    ).toBe(503);
    expect((await handleApiRequest(req({}), offlineDeps)).status).toBe(200);
  });

  it("unknown route 404s", async () => {
    expect((await handleApiRequest(req({ path: "/api/nope" }), liveDeps)).status).toBe(404);
  });
});
