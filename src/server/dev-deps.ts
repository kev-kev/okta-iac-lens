/**
 * server/dev-deps: wires the pure API handler to the real live-read dependencies for the Vite
 * dev-server middleware. Loaded at dev-server start via `ssrLoadModule` (so the project's NodeNext
 * `.js` import specifiers resolve through Vite's pipeline, not the config bundler). Node context.
 *
 * The SSWS token is read from the environment here, server-side, and never leaves this process
 * except in the Okta `Authorization` header (inside `HttpOktaReader`).
 */

import { loadDotEnv, loadLiveResources, loadUserMembership } from "../inputs/load-resources.js";
import { readOktaConfigFromEnv } from "../inputs/okta-api.js";
import { buildGraph } from "../core/build-graph.js";
import { appAuthPolicyRules } from "../analysis/policy-strength.js";
import { makeEnvelope } from "../render/envelope.js";
import type { ApiDeps } from "./api.js";

export { handleApiRequest } from "./api.js";

/** Build the live dependency set. `live` is false when credentials are absent → live routes 503. */
export function buildApiDeps(): ApiDeps {
  loadDotEnv();
  let live = false;
  try {
    readOktaConfigFromEnv();
    live = true;
  } catch {
    live = false; // no creds — the viewer will degrade to offline via /api/health
  }
  return {
    live,
    loadMembership: (login) => loadUserMembership(login),
    loadEnvelope: async () => {
      // Carry the captured policy rules (M15 Phase D) so the live-pulled graph bands policies too.
      const live = await loadLiveResources();
      return makeEnvelope(
        buildGraph(live),
        "okta",
        new Date().toISOString(),
        undefined,
        appAuthPolicyRules(live),
      );
    },
  };
}
