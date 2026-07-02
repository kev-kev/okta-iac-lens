# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 2 ships, rewrite this for M3.

> **Status of M1:** shipped. The static path from `terraform show -json` -> `ParsedResource[]` -> `OktaGraph` -> `trace()` is built and tested against `fixtures/sample-tenant.tfstate.json`. M2 builds a *second input* that produces the same normalized records, so `build-graph` and `access-paths` are reused unchanged.

## Milestone 2: live read-only Okta tenant reader

> **Status (2026-07-01):** Phase A is built and green (23 tests), and the Integrator tenant now exists — so parts of Phase B ran early, out of order on purpose: verifying real API shapes *before* writing the mapper beat writing it against assumptions. Done: read-only credential (verified — write probe got 403), live smoke of all five endpoints (`npm run smoke -- --verify-readonly`), shape reconciliation, mapper + equivalence oracle + CLI `--source okta` (works live). Remaining in Phase B: seed the tenant (apps + a group rule — the two response shapes a fresh tenant can't show, currently authored from docs), then the ground-truth acceptance test.

**Goal:** add `src/inputs/okta-api.ts`, a **read-only** reader that pulls Groups, Apps, group rules, and both policy layers from a live Okta tenant and emits the **same `ParsedResource[]` shape** that `parse-tfstate.ts` already produces. Feeding that into the existing `buildGraph` must yield an `OktaGraph` the existing `trace()`/`summary` operate on with **zero changes to `src/core/`**.

**The load-bearing design decision:** the live reader's output type is `ParsedResource[]` (the tagged union in `src/core/parse-tfstate.ts`), NOT the graph and NOT a new SDK-shaped type. That normalized intermediate is the seam between "where data comes from" (tfstate file vs live API) and "what we compute" (graph + traversal). If M2 introduces a parallel model, that's a design smell — stop and reconsider.

**Hard constraint (this milestone cannot be fully finished without a tenant).** I do **not** yet have an Okta Integrator test tenant. So M2 splits into **Phase A (buildable now, against recorded/mocked responses)** and **Phase B (blocked on a live tenant)**. Do all of Phase A. Do not attempt Phase B until I confirm a tenant exists.

---

## Phase A — buildable now (no live tenant, no real credentials)

Everything here is validated against **recorded/mocked JSON fixtures of API responses**, never a live call. This keeps `src/core/` pure and testable with zero environment, exactly as M1 is.

### Steps (pause at the checkpoint)

1. **Dependency evaluation for `@okta/okta-sdk-nodejs`** (per CLAUDE.md — check current version + that it's actively maintained *before* adding it). Record findings in this file: latest version, last release date, whether it's the officially supported client, its auth models (API token vs OAuth 2.0 private-key/scoped), and its pagination shape. Decide SDK vs. a thin `fetch` wrapper against the Okta REST API. Bias toward the SDK **only if** it's current and doesn't drag in heavy/unmaintained transitive deps; otherwise a small typed `fetch` client is acceptable and keeps the dependency surface minimal. Do not add the dependency until this step is written up.

2. **Define the response-fixture set** `fixtures/api/` — hand-authored JSON matching the **documented** Okta API response shapes for the pinned API version, one file per endpoint:
   - `groups.json` (`GET /api/v1/groups`)
   - `apps.json` (`GET /api/v1/apps`)
   - `group-rules.json` (`GET /api/v1/groups/rules`)
   - `policies-signon.json` (global session policies + their `conditions.people.groups.include` — the group ids each applies to)
   - `app-signon-policies.json` (app auth policies) + the app->policy linkage (`GET /api/v1/apps/{id}` `_links.accessPolicy`, or `/policies?type=ACCESS_POLICY` with app mappings)
   These fixtures are the M2 oracle. They must be shaped like **real API responses**, not like tfstate — that shape difference is the whole point of the mapping layer. Where the exact shape is uncertain without a tenant, note the assumption inline and flag it for Phase B verification.

3. **`src/inputs/okta-api.ts` — the reader interface + client boundary.** This is the I/O boundary (like `tfstate-file.ts`); no logic from `src/core/` moves here. Shape it as:
   - A narrow `OktaReader` interface with one read method per resource kind (e.g. `listGroups()`, `listApps()`, `listGroupRules()`, `listGlobalSessionPolicies()`, `listAppAuthPolicies()` + app linkage), each returning the **raw API JSON** typed to the documented shape.
   - A concrete `HttpOktaReader` implementing it against the live API (paginated, read-only). **Its constructor takes config; it makes no calls at construction.** Actual live calls are exercised only in Phase B.
   - Credential/config plumbing read from **env vars only** (`OKTA_ORG_URL`, plus either `OKTA_API_TOKEN` or the OAuth client-id/scopes/private-key set) — never hardcoded, never logged. Add the placeholders to `.env.example`. Wire the **read-only scopes** `okta.groups.read`, `okta.apps.read`, `okta.policies.read` and assert/annotate that nothing requests write scopes.
   - Fail loudly with a clear message if required env vars are missing.

4. **`src/inputs/map-api.ts` (or `okta-api-map.ts`) — PURE mapping: raw API JSON -> `ParsedResource[]`.** This is the actual brainwork of M2 and it must be pure (no I/O, no network) so it tests against the `fixtures/api/` files with zero environment. It is the API-side analogue of `parse-tfstate.ts`. It must:
   - Map each API object to the matching `ParsedResource` variant, using the **same ids** (`id` join key) so edges wire up identically to the tfstate path.
   - Keep the **two policy layers separate** (global session policy `appliesTo` groups via `conditions.people.groups.include`; app auth policy `protects` apps via the app's access-policy link) — same rule as M1, do not collapse them.
   - Handle the **`okta_app_group_assignments` plural gotcha** correctly: the live API returns ALL groups assigned to an app (`GET /api/v1/apps/{id}/groups`), which is exactly the plural-resource behavior M1 deferred. Here it's not a gotcha, it's the natural read — emit one `AppGroupAssignment` record per (app, group). Note in a comment that this is why live-vs-state can legitimately differ (the seed of M3 coverage).
   - Preserve the "no app auth policy == org default, not unprotected" semantic from `model.ts`.

--- CHECKPOINT (RESOLVED 2026-07-01) ---
Original intent: confirm assumed API shapes before the mapper calcified them. Resolved better than planned — the tenant arrived early, so shapes were verified against *reality* (live smoke + capture to `generated/okta-captures/`), not just docs. The open default-policy question was settled empirically: every app carries an `_links.accessPolicy` link, and the org default is identifiable as the single `system: true` ACCESS_POLICY ("Any two factors"). Mapper rule: app -> system policy == org default == `authenticationPolicyId: null`, and system policies are not emitted as `AppAuthPolicy` nodes. Known edge case (accepted, flagged for M3): Terraform config that EXPLICITLY assigns the org-default policy shows a `protects` edge on the tfstate path but null on the live path.
--- END CHECKPOINT ---

### Dependency evaluation (step 1 writeup, recorded 2026-07-01)

**Decision: no SDK — thin typed client on Node's native `fetch` (`HttpOktaReader`, ~150 lines).**

- `@okta/okta-sdk-nodejs` latest: v8.1.0 (2026-05-06). Actively maintained, official, ships own TS types — it passes the CLAUDE.md maintenance bar.
- Rejected anyway: it depends on legacy `node-fetch@2` (predates native fetch) and a crypto stack (`njwt`, `node-jose`, `eckles`, `rasha`) that exists to support OAuth 2.0 private-key-JWT auth. We use SSWS token auth and need exactly six paginated read-only GETs; none of that weight buys us anything.
- Revisit if M3+ ever needs OAuth service-app auth (DPoP/private-key JWT) — that's the point where the SDK starts paying for its dependencies.
- Pagination: Okta pages via the `Link: <url>; rel="next"` response header (RFC 5988); `HttpOktaReader.getPaginated` follows it. Confirmed working live.

### Live smoke findings (2026-07-01, fresh Integrator tenant)

- Groups: `id` + `profile.name` — fixture shape CONFIRMED. Fresh tenant ships `Everyone` and `Okta Administrators`.
- OKTA_SIGN_ON policy: `conditions.people.groups.include` sits on the policy itself — CONFIRMED (default policy includes the `Everyone` group id, `system: true`).
- ACCESS_POLICY list: 6 built-ins on a fresh tenant; exactly one is `system: true` ("Any two factors") — the org default. Okta-created-but-not-system policies (Okta Dashboard, Admin Console, etc.) appear as normal policies and WILL show up in live summaries; that is live truth, not a bug.
- Apps and group rules: fresh tenant returns 0 of each, so `fixtures/api/apps.json` and `group-rules.json` shapes are still doc-derived, NOT live-verified. Re-verify both after seeding (first Phase B task below).
- Read-only rail: POST /api/v1/groups with the token -> **403**. Credential provably cannot write.

5. **Reuse `buildGraph` unchanged.** Prove it: a test that takes the `fixtures/api/` records through the mapper -> `buildGraph` -> `trace()` and asserts the same graph invariants M1 asserts. If `buildGraph` needs *any* change to accept API-sourced records, that's a signal the mapper isn't hitting the `ParsedResource` contract — fix the mapper, not core.

6. **Wire a CLI surface, but keep it inert without creds.** Add an input-source option so `summary`/`trace` can target either a state file (M1, default) or the live API (M2), e.g. `--source tfstate|okta` or a `--okta` flag. When `--okta` is chosen but env vars are absent, exit with a clear "set OKTA_ORG_URL / token to use live mode" message — do **not** silently no-op. The live path stays untested end-to-end until Phase B; the arg-parsing and the missing-creds error path are testable now.

7. **Tests (all offline).** vitest coverage for: the mapper against every `fixtures/api/` file (the M2 oracle below); the reuse-buildGraph integration test; the CLI missing-creds error path. Then run `npm test` and show me actual output.

### Test oracle for Phase A (defines "correct" without a tenant)

Author `fixtures/api/` to describe **the same logical tenant as the M1 fixture**, so the two inputs are provably interchangeable. That is the strongest offline check available: *the live-API path and the tfstate path, given the same tenant, must produce the same graph.*

- Groups: `Engineering` (id `g-eng`), `Contractors` (id `g-con`)
- Apps: `GitHub` (id `a-gh`), `Datadog` (id `a-dd`)
- App-group assignments (from the live `/apps/{id}/groups` reads): `g-eng -> a-gh`, `g-eng -> a-dd`, `g-con -> a-gh`
- Group rule `eng-rule`: populates `g-eng` (raw expression stored literally, NOT evaluated)
- Global session policy `Default-MFA` (id `p-sess`): appliesTo `g-eng`
- App auth policy `Strict-Auth` (id `p-auth`): protects `a-dd`

Expected results (identical to M1 — that identity IS the test):

- Mapping the API fixtures produces a `ParsedResource[]` that, through `buildGraph` + `trace`, gives:
  - `trace("Engineering")` -> apps = [GitHub, Datadog]; globalSessionPolicy = `Default-MFA`; appAuthPolicies = { a-gh: null, a-dd: `Strict-Auth` }
  - `trace("Contractors")` -> apps = [GitHub]; globalSessionPolicy = null; appAuthPolicies = { a-gh: null }
  - `summary` -> 2 groups, 2 apps, 1 group rule, 1 global session policy, 1 app auth policy
- A dedicated equivalence test asserts the graph built from `fixtures/api/` deep-equals (modulo node/edge ordering) the graph built from `fixtures/sample-tenant.tfstate.json`.

A test passes only when output matches the above. If a documented API shape turns out to differ from what I authored (discoverable only in Phase B against a real tenant), fix the fixtures to match reality and re-run — same discipline as the M1 fixture note.

### Phase A done when

- `@okta/okta-sdk-nodejs` (or the fetch-client decision) is evaluated and written up here.
- `fixtures/api/*.json`, `okta-api.ts` (reader interface + HTTP client, no calls at construction), and the pure `map-api.ts` mapper exist.
- `npm test` is green, including the mapper oracle, the API-vs-tfstate graph-equivalence test, and the CLI missing-creds error path.
- No live network call has been made and no real credential exists in the repo or its history.

---

## Phase B — live-tenant work (tenant EXISTS as of 2026-07-01; partially done)

- [x] Provision a free Okta Integrator tenant. ~~Seeding~~ — still open, see below.
- [x] Create a **read-only** API credential. (Reality check vs. the original plan: SSWS tokens can't be scope-limited — they inherit their creator's permissions. Implemented as an SSWS token minted by a **Read-Only Administrator** user; the OAuth scope list applies only if we ever switch to an OAuth service app. CLAUDE.md rail updated to match.) Values live in git-ignored `.env`.
- [x] **Live smoke test:** `npm run smoke -- --verify-readonly` — all five endpoints return, pagination handled, write probe 403'd. Raw captures land in `generated/okta-captures/` (git-ignored).
- [x] **Shape reconciliation (partial):** groups + both policy layers verified live and fixtures corrected (`system` flags added; two fixture bugs vs. the tfstate fixture fixed: group-rule id `gr-eng`, aligned expression strings; GitHub set to OPENID_CONNECT to match its tfstate `okta_app_oauth`).
- [ ] **Seed the tenant** to mirror the logical fixture (2 groups, 2 apps, 1 group rule, 1 custom global session policy, 1 custom app auth policy) — ideally via Terraform, which doubles as the real `terraform show -json` export deferred from M1. Manual console seeding is acceptable if Terraform setup is deferred.
- [ ] **Re-verify the two unverified shapes after seeding:** `/api/v1/apps` items (incl. `_links.accessPolicy` on a customer-created app) and `/api/v1/groups/rules` items. Correct fixtures + mapper if reality differs, re-run offline tests.
- [ ] **Ground-truth acceptance test (the real acceptance criterion, per CLAUDE.md):** pick a test user in the tenant; compare the tool's computed app access + applied policies for that user against what the Okta admin console actually shows. Match = model is right. Divergence = a bug or a misunderstood semantic — investigate before declaring M2 done.
- [ ] Record any remaining API shape quirks discovered, so they're pinned like the provider resource names in CLAUDE.md.

## Deferred (do NOT build in M2)

- Coverage reconciliation + import-block generation (M3) — even though the live `/apps/{id}/groups` read makes the live-vs-state gap visible, computing and reporting that diff is M3.
- Okta Expression Language evaluation for hypothetical-user traces (still flagged brittle).
- Web visualization (after the CLI proves the model).
- Any WRITE operation against Okta. M2 is read-only, full stop.
- Plan-diff view (`terraform plan -json`).
