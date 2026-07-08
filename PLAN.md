# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 9 ships, rewrite this for M10.

> **Shipped:** **M1** static trace. **M2** live read-only reader (graph equivalence + ground truth). **M3** `coverage` reconciliation + import blocks. **M4** static web viewer (policies as card attributes; group-trace + policy-sharing). **M5** coverage overlay + recommended steps. **M6** scale the viewer (query-first landing + cohort overview + bounded depth-1 focus + hub truncation; slim envelope). **M7** user-level access trace (`trace --user`; a user is a trace INPUT, not a graph node; live ground truth; security review clean). **M8** risk-ranked landing + blast-radius (pure `rankRisk` reach × gate × IaC, CLI + viewer sort; O(N+E); security review clean).

## Milestone 9: local read-only server → live, VISUAL user-access trace in the viewer

**Goal:** bring the M7 user trace into the GUI, **visually**, live. The viewer was deliberately static/no-network, but a user trace needs a live email→groups lookup — which the browser can't do (the SSWS token can't live in browser JS; Okta refuses browser-origin calls). Solution: **browser → localhost → Okta, token server-side.**

**Design (load-bearing):**
- **Server = Vite dev-server middleware** (`configureServer`), not a hand-rolled static-file server — avoids a path-traversal surface; live features exist only under `npm run web`, the static `dist-web` bundle stays offline. No new dependency.
- **Security (the crux): localhost + Host/Origin allowlist.** GET-only, read-only; reject non-loopback `Host` (DNS-rebinding defense) and cross-site `Origin`. The SSWS token stays in the Node process — never returned, never logged.
- **Thin server, pure browser:** the server returns `{user, groupIds}` + live envelopes; the browser runs the same pure `traceUser`/`explainUserApp` in-process (identical to the CLI).
- **Visual (required):** the trace renders on the **canvas** via the existing `GraphView` (the user's groups → apps subgraph, policy badges), beside a textual `UserTracePanel`.

### Phase A — server + endpoints + security ✅ (shipped)
- [x] `src/server/api.ts` — transport-agnostic `handleApiRequest` + security gate (GET-only, loopback Host, same-origin). Routes: `/api/health` (live probe), `/api/graph` (live envelope), `/api/user-membership?login=` ({user, groupIds}; 400/404/503, token never leaked).
- [x] `vite.config.ts` `configureServer` middleware (`ssrLoadModule` so NodeNext `.js`→`.ts` resolves); creds absent ⇒ health `live:false` + live routes 503.
- [x] `test/api.test.ts` (11) — security gate + routes, pure/no sockets. Verified live via curl (health 200; spoofed Host / cross-Origin / POST rejected).

### Phase B — viewer live mode + visual user trace ✅ (shipped)
- [x] `App.tsx` — `/api/health` probe → `liveMode`; "Load tenant live" (→ `/api/graph` → existing `parseEnvelope`); user-trace input → `/api/user-membership` → `traceUser` in-browser.
- [x] `UserTraceView` + `UserTracePanel` + pure `buildUserAccessGraph` (the user's slice → `deriveCards` → `GraphView`). +3 tests (139 total); `web:build`/`web:typecheck` clean.
- [x] **User-confirmed:** tracing a real user renders correctly on the canvas + panel; UI legible (CSS fix: `.file-btn` color + React Flow attribution).

### Phase C — wrap (in progress)
- [x] CSS legibility fix; README + PLAN updated (live mode; token stays server-side; static-bundle claim corrected).
- [x] **Security review — CLEAN**, no HIGH/MEDIUM findings: Host allowlist blocks DNS-rebind + LAN (exact loopback match, holds even under `vite --host`); Origin check blocks cross-site reads; GET-only/read-only; token stays server-side, never in a response or log; `login` `encodeURIComponent`'d (no SSRF/traversal); no custom static serving; React auto-escapes.
- [ ] PR; merge to `main`; branch cleanup.
- [ ] (Optional) Screenshot the on-canvas user trace → README.

## Deferred (do NOT build in M9) → later

- **Standalone production `serve` command** (a `node:http` server over the built `dist-web` bundle) — nice for a bundle demo, but adds a custom static-file handler (path-traversal surface); defer until wanted.
- Coverage/risk **live** endpoints (coverage needs a state upload — separate); auth/multi-user; exposing the server beyond localhost.
- Policy-outlier views (backlog #4); what-if / plan-diff (#5); runtime policy-condition / OEL evaluation.
- Any WRITE to Okta. Read-only, local, full stop.

## Backlog — "The opinionated layer" (post-M9)

1. ~~User-level trace~~ → M7. 2. ~~Risk-ranked landing~~ → M8. 3. ~~Blast-radius~~ → M8. (User trace in the GUI → M9.)
4. **Policy outlier views** — apps behind a weaker policy than their cohort (table/heatmap; the parked adjacency-matrix fits here).
5. **What-if** — plan-diff (next overlay) and persona/birthright simulation — still deferred as brittle (needs OEL).

Rails if picked up: read-only always; users per-lookup, never bulk-drawn; logic pure in `src/core`/`src/analysis`, tested against fixtures.
