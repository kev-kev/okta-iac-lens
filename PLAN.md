# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 12 ships, rewrite this for M13.

> **Shipped:** **M1** static trace. **M2** live read-only reader. **M3** `coverage` + import blocks. **M4** static web viewer. **M5** coverage overlay + recommended steps. **M6** scale (query-first landing + bounded focus). **M7** user-level access trace. **M8** risk ranking. **M9** local read-only server + visual user trace. **M10** policy outliers + Group×Policy heatmap. **M11** validation hardening — provider fact table, adversarial seed, sanitized real fixtures (`fixtures/api-real/`), and the expected-red suite (`test/expected-red.test.ts`: 6 `it.fails` reds + 3 closed docs). The reds are M12–M14's acceptance criteria.

## Context: what M11 armed

`test/expected-red.test.ts` runs against the sanitized real-tenant fixtures (which carry the M11 adversarial seed). Six `it.fails` tests assert Okta ground truth that the tool violates today. Each names the milestone that greens it. M12 owns five of them outright; #7 is shared M12/M13 (see below).

**The M11 provider fact table (PLAN M11 lines, now in git history at `b9d8a3e`) is the source of truth** for: the 9 `okta_app_*` APP resources vs the 9 NON-APP lookalikes, that `okta_app_access_policy_assignment` exists (`app_id`+`policy_id`), and that `okta_policy_signon` carries `priority`+`status`. M12 encodes it.

## Milestone 12: make the graph true

**Goal:** the parser and traversal stop lying about the graph. Junk App nodes disappear, an INACTIVE rule populates no one, the session policy is chosen by priority, and individual (`okta_app_user`) assignments are counted instead of silently dropped or misparsed. Do the `ParsedResource`/model/envelope widening **ONCE** (one envelope version bump, `status`/`priority` shaped to also fit M15's rule refs), so M13–M15 don't re-bump.

**Rails (unchanged):** core stays pure (no I/O in `src/core`, `src/analysis`). All tool reads read-only. **A user is never a graph node** — this is why `okta_app_user` is *counted and surfaced*, not wired into `traceUser` as an edge; the real per-user inclusion is M13's live appLinks diff.

### Reds this milestone greens (delete each `.fails` marker as it flips)

| # | Red (from `expected-red.test.ts`) | M12 fix |
|---|---|---|
| 1 | `okta_app_*` lookalikes must not become App nodes | APP-type **allowlist** in `parse-tfstate` |
| 1b | junk node must not appear as `stale` App in coverage | same allowlist (junk node never created) |
| 1c | tfstate vs live App count must agree | same allowlist |
| 3 | session policy chosen by **priority**, not address order | carry `priority`+`status` on `GlobalSessionPolicy`; `sessionPolicyForGroup` picks min-priority ACTIVE |
| 4 | INACTIVE group rule populates **no one** | carry `status` on `GroupRule`; build-graph emits **no `populates` edge** for INACTIVE rules (node kept, annotate-not-filter) |
| 7 | *(shared M12/M13)* user trace includes individually-assigned Salesforce | **M12: count+surface** `okta_app_user`; **M13: include in trace** via appLinks diff. Leave `.fails` marked until M13. |

### The one widening (design for M15 too)

**`ParsedResource` (`parse-tfstate.ts`) + node types (`model.ts`):**
- `App`: add `status?: string` (`values.status`; live `app.status`). Default treated as ACTIVE when absent.
- `GroupRule`: add `status?: string`.
- `GlobalSessionPolicy`: add `priority?: number` (`values.priority`) + `status?: string`.
- `AppAuthPolicy`: add `priority?: number` + `status?: string` (parity + M15 rule-ordering substrate; may be unused by M12 traversal).
- New kind **`AppUserAssignment`** `{ appId, userId, address }` from `okta_app_user`. NOT a graph node/edge (users aren't nodes). Flows into **coverage** (new kind row → counted, never dropped) and a **summary notice**.
- New kind **`AppAccessPolicyAssignment`** `{ appId, policyId, address }` from `okta_app_access_policy_assignment`. build-graph emits a `protects` edge (the second path to a `protects` edge besides inline `authentication_policy`). No fixture exercises it (M11 #2 closed), so cover it with a synthetic unit test.

`status`/`priority` are **optional** everywhere so idealized `fixtures/api/` + `sample-tenant` (which omit them) still parse and stay ACTIVE-by-default → existing 168 tests unchanged.

**Allowlist:** replace `APP_TYPE_DENYLIST` with `APP_TYPE_ALLOWLIST` = the 9 APP resources (`app_auto_login, app_basic_auth, app_bookmark, app_oauth, app_saml, app_secure_password_store, app_shared_credentials, app_swa, app_three_field`). `isAppType` = allowlist membership. Only affects the tfstate path (`map-api` emits `App` directly). The 9 NON-APP lookalikes that slipped through now don't.

**Traversal (`access-paths.ts`):**
- `sessionPolicyForGroup`: among `appliesTo` policies for the group, skip INACTIVE, pick **lowest `priority`** (absent priority sorts last, per Okta "API defaults to last/lowest"); deterministic tie-break by id.
- INACTIVE handled in build-graph (no `populates` edge), so `rulesPopulatingGroup`/`traceApp` need no change for #4.

**Envelope (`render/envelope.ts`):** bump `ENVELOPE_VERSION` 1 → 2 (the graph now carries `status`/`priority` on nodes). Update `parse-envelope.ts` to accept 2 (and reject/upgrade 1 as appropriate); update `envelope.test.ts`. Regenerate any committed scale/sample envelope the tests read.

**Render (`render/cli.ts`):** `"(none)"` session-gate wording → `"org default session policy"`. Surface the `okta_app_user` count in `summary` ("N individual assignments present, not modeled"). Optionally note INACTIVE rules where they'd otherwise print.

### Phases

- **A — widen the substrate.** ✅ `parse-tfstate.ts` (allowlist, `status`/`priority`, two new kinds) + `map-api.ts` (same fields from live) + `model.ts` node fields.
- **B — fix traversal.** ✅ `sessionPolicyForGroup` picks lowest-priority ACTIVE; build-graph emits no `populates` edge for INACTIVE rules.
- **C — count + surface.** ✅ `okta_app_user` → `AppUserAssignment`, COUNTED (`countIndividualAssignments`) + `summary` notice — **kept OUT of coverage's KIND_ORDER** (the read-only live snapshot structurally can't contain individual/access-policy assignments, so bucketing them would be a false `stale`; more honest for M14 too). `okta_app_access_policy_assignment` → `protects` edge (synthetic unit test; no fixture). `"(none)"` session gate → `"— org default session policy"`.
- **D — envelope.** ✅ **NO version bump.** The `status`/`priority` node fields are OPTIONAL and the viewer reads neither — purely additive, exactly like the M5 coverage field (which also didn't bump). A v1 viewer renders a v2 graph unchanged. M11's synthesis pencilled a bump; the widening turned out additive, so `ENVELOPE_VERSION` stays 1 (documented in `envelope.ts`). Bump only on a truly breaking change (maybe M15 rule refs). No committed envelopes to regenerate (all `generated/` are gitignored).
- **E — verify + lock.** ✅ Suite: **197 passed | 1 expected-fail** (#7, held for M13). Reds #1/#1b/#1c/#3/#4 greened → `.fails` markers removed. New positive/regression tests: allowlist rejects the 9 lookalikes + parses the 9 apps; the two new kinds; status/priority carry-through; priority pick (order-independent, INACTIVE-skip, absent=last, id tie-break); INACTIVE→no populates edge; access-policy-assignment→protects; individual-assignment count + coverage exclusion; renderSummary notice. Build + web:typecheck clean; M10 `outliers` live demo still flags GitHub. **Human still to re-verify** the live seed trace against the console.

**Done when:** reds #1, #1b, #1c, #3, #4 green (markers removed) ✅ and #7's count/surface half delivered (its `.fails` documents the remaining M13 trace work) ✅; no envelope bump needed (additive) ✅; existing tests still pass + new tests lock each fix ✅; live seed trace still matches the console (human check pending).

## Roadmap (rewrite this file per milestone as each starts)

- **M13 — make the claims honest.** Relabel strength claims direction-neutral (`weaker-than-peers` → `default-while-peers-custom`; rank-risk weak/strong → a documented divergence prior); user trace gains the `appLinks` diff ("+N via individual assignment", within the users-per-lookup rail) — **greens red #7's trace half**; caveats on every gate/severity surface. Phase A (relabel) is independent — pull it forward if anything demo-facing looms.
- **M14 — make coverage truthful.** Built-in apps excluded (identities from the M11 captures, not hardcoded); AppAuthPolicy exclusion keyed to MANAGED/excluded referencing apps; plural-sourced assignment pairs tagged + annotated "state-tracked; absorbs drift". **Prerequisite (M11 Phase D finding):** committed real state does NOT yet carry the Confluence click-ops drift — human must re-export state after the click-ops add + re-sanitize first, else there's no failing silent-absorption fixture.
- **M15 — policy strength for real.** Rule capture (`okta_app_signon_policy_rule`; live `GET /policies/{id}/rules`) → factor-based strength bands → grounded weaker/stronger verdicts with evidence. Builds on M12's `status`/`priority` substrate (no envelope re-bump).

## Nice-to-haves (batch opportunistically; never a milestone)

- Matrix "Other"-fold masking: soften the "never disagree with the table" doc claim (comment edit); behavior fix only if >6-custom-policy tenants become real.
- `HttpOktaReader`: one 429 retry honoring `Retry-After`; `limit=200` on paginated lists.
- Small-tenant "View app in graph" for org-default outlier apps; `blastLine` rule dedupe.
- `matchSegments` Unicode length edge; `perSideCap` resize.

## Explicitly not doing (decided 2026-07-10, revisitable)

- **Bulk individual-assignment modeling** (`/apps/{id}/users` across all apps): violates the users-per-lookup PII rail; the appLinks diff (M13) + `okta_app_user` presence signal (M12) cover the audit story.
- **Coverage against CONFIG (plan-JSON) instead of state:** the M14 annotation delivers most of the honesty; config parsing is a large lift for a personal tool.
- Threshold CLI flags, OEL evaluation, what-if simulation, any WRITE to Okta. Read-only, local, full stop.
