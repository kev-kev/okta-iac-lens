# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 7 ships, rewrite this for M8.

> **Shipped:** **M1** static trace (`terraform show -json` → `ParsedResource[]` → `OktaGraph` → `trace`/`summary`). **M2** live read-only reader emitting the same `ParsedResource[]`; graph equivalence + admin-console ground truth passed. **M3** `coverage` reconciliation (presence-first classification over the shared seam) + import blocks confirmed against okta/okta v4.20.0; live click-ops ground truth passed. **M4** static web viewer (Vite + React Flow + dagre; policies as card attributes; group-trace + policy-sharing); live ground truth; CI; security review clean. **M5** coverage overlay + recommended steps (managed/unmanaged/excluded badges; pure `recommend()` in CLI + viewer). **M6** scale the viewer to enterprise tenants (query-first landing + cohort overview + bounded depth-1 focus views + hub truncation; slim envelope; synthetic-scale invariants tested); screenshot at 15k nodes; security review clean.

## Milestone 7: user-level access trace — `trace --user <email>`

**Goal:** answer the single most common enterprise IT question — *"what is user U provisioned to, and how?"* (and its `--app` narrowing, *"why does / doesn't U reach app A?"*) — without violating the users-out-of-scope scale decision.

**The load-bearing design decision:** a **User is a trace INPUT, not a graph node.** One user is looked up live (read-only): email → user → group-id list. That list is fed into the existing group→app→policy machinery. This scales (one user per lookup, no user nodes), keeps `src/core/` pure and fixture-testable (membership is just an id array — no PII fixture), and adds only two read-only endpoints as I/O. Confirmed anticipated by the M7 backlog note.

**Semantic rails (load-bearing — the tool's credibility):**
- Wording is **"provisioned to / gated by," never "can access."** A static read can't evaluate runtime policy conditions (MFA, device, network); the output says so on every trace.
- **Provenance is honest, never evaluated.** A group is labeled rule-populated iff a `populates` edge targets it; the rule expression is surfaced verbatim for a human to read. We never claim the user entered via that rule (Okta's `/users/{id}/groups` doesn't expose per-user source; no OEL evaluation, ever).
- **"org default" ≠ unprotected** — preserved from M1; a null app auth policy renders as "org default app sign-on policy."
- **PII:** user email/id are PII. No user fixture is ever committed; pure tests synthesize id arrays. `.gitignore` already denies real exports; the token is never logged.

### Phase A — offline ✅ (shipped)

- [x] **Pure core** (`src/core/access-paths.ts`): factored the edge-walks (`appsGrantedByGroup`, `groupsGrantingApp`, `sessionPolicyForGroup`, `authPolicyForApp`, `rulesPopulatingGroup`) so `trace`/`traceApp`/`traceUser` share one traversal; added `traceUser(graph, {user, groupIds})` → `UserTraceResult` and `explainUserApp(graph, result, appNameOrId)` → `UserAppExplain` (positive path + honest no-access explainer). Behavior-preserving: all M1–M6 tests stay green.
- [x] **Live input** (`src/inputs/okta-api.ts`): `RawUser`, separate `OktaUserReader` interface (`getUserByLogin`, `listUserGroupIds`) on `HttpOktaReader`, reusing the SSWS/pagination machinery. `loadUserMembership(login, reader?, env?)` in `load-resources.ts` — the thin PII boundary, credential-guarded before any network call.
- [x] **CLI** (`src/cli.ts`): `trace --user <email>` (+ `--app` filter); guards (`--user` needs `--source okta`; not combinable with `--group`).
- [x] **Render** (`src/render/cli.ts`): `renderUserTrace` + `renderUserAppExplain`, mirroring the existing renderers; runtime caveat on every statement.
- [x] **Tests:** `test/access-paths-user.test.ts` (pure `traceUser` oracle, membership synthesized) + `test/cli-user.test.ts` (loader credential guard + injected-reader mapping + both renderers, positive & negative). `npm test` 116 green; `npm run build` + `npm run web:build` clean.

### Phase B — ground truth + wrap (pending)

- [x] **Live acceptance (the real oracle):** PASSED against the free Integrator tenant. `trace --user kevin-personal@kevctech.com --source okta`: in Everyone only → 0 apps (matches console); after adding to Engineering → Datadog (Strict-Auth) + GitHub (org default) via Engineering, correct provenance (Everyone=direct, Engineering=rule eng-rule `user.department=="Engineering"`), distinct per-group session gates (Default Policy vs Default-MFA). Matches the admin console. Scope resolved incidentally: live `/users/{login}` returned 404 not 403 — the Read-Only Admin SSWS token can read users. *(Known boundary surfaced: apps assigned DIRECTLY to a user, not via a group, are not traced — group-based by design; v2 candidate.)*
- [x] Branch `/security-review` — **clean**, no HIGH/MEDIUM findings: new user endpoints encode the login (`encodeURIComponent` + `new URL`, no SSRF/traversal), token never logged, PII never persisted (no user fixture), trusted-API JSON only, no write path added. PR; merge to `main`.
- [ ] (Optional) README screenshot/paste of a real user trace once ground-truth passes.

## Deferred (do NOT build in M7)

- **Negative case beyond the `--app` explainer** (full "nearest miss" enumeration across all apps).
- Runtime policy-condition / OEL evaluation — we surface rule expressions verbatim, never evaluate.
- Web-viewer surface for user trace (CLI-only in v1).
- Bulk user analysis / drawing users as graph nodes (violates the users-as-input decision).
- Any WRITE operation against Okta. Read-only, full stop.

## Backlog — "The opinionated layer" (M8 scoping input)

At enterprise scale engineers arrive with a question (ticket, audit, change, posture review). The canvas earns its keep for **path explanation** and **blast radius**; everything else is **ranked lists, tables, quadrants, and diffs that link into the canvas**. Candidates, ranked (item 1, user trace, is now shipping as M7):

1. ~~User-level trace~~ → **M7 (this milestone).**
2. **Risk-ranked landing** (cheap — data in hand): reach (groups-per-app / apps-per-group) × gate strength (org-default vs custom auth policy) × IaC status (unmanaged). "Widest reach, weakest gate, not in Terraform" sorts first; quadrant + ranked inventory replacing alphabetical sort.
3. **Blast-radius framing of the focus view** (near-free): "42 apps and 3 rules depend on this group."
4. **Policy outlier views** — apps behind a weaker policy than their cohort (table/heatmap; the parked adjacency-matrix fits here).
5. **What-if:** plan-diff (next overlay) and persona/birthright simulation ("what does a new dept=X hire get?") — still deferred as brittle (needs OEL).

Rails if picked up: read-only always; users are per-lookup trace inputs, never bulk-fetched or drawn in bulk; ranking logic pure in `src/analysis/`, tested against fixtures.
