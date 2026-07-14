# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 11 ships, rewrite this for M12.

> **Shipped:** **M1** static trace. **M2** live read-only reader (graph equivalence + ground truth). **M3** `coverage` reconciliation + import blocks. **M4** static web viewer. **M5** coverage overlay + recommended steps. **M6** scale (query-first landing + bounded depth-1 focus). **M7** user-level access trace. **M8** risk ranking. **M9** local read-only server + visual user trace. **M10** policy outliers (divergence edition) + Group×Policy heatmap. *(M10's live ground truth — seed apply + `outliers --source okta` flagging GitHub — was still open at merge; it moves into M11 Phase C.)*

## Context: the 2026-07-10 full-repo review

Two findings sets drive M11–M15:

1. **Correctness (ranked):** `okta_app_*` lookalikes parsed as App nodes (denylist too narrow); `protects` edges missed when config uses `okta_app_access_policy_assignment`; ACTIVE/INACTIVE `status` ignored on apps/rules/policies; session-policy `priority` dropped (first-edge-wins is address order on the tfstate path); coverage misclassifies Okta built-in apps (and their auto-created policies) as unmanaged gaps; matrix "Other"-fold can mask divergence; "(none)" session-gate wording.
2. **Structural blind spots:** gate-strength labels assert a direction the model can't ground (custom ≠ stronger — the org default is "Any two factors"; custom policies also RELAX); individual user→app assignments are an unmodeled access channel (`traceUser` is group-union only); coverage measures against STATE, which absorbs click-ops drift for plural `okta_app_group_assignments`; and the fixtures/ground truth validate an idealized tenant, so none of the above can surface as a failing test.

**Synthesis:** the harness can't see any of it, so instrument first (M11), then make the graph true (M12), the claims honest (M13), coverage truthful (M14), and only then build strength ordinals on the corrected substrate (M15). Shared-cost note: status + priority + (later) rule capture all widen the same schema — do the ParsedResource/model/envelope widening ONCE in M12 (one envelope version bump), designed with M15 in mind.

## Milestone 11: ground the harness in reality (validation hardening)

**Goal:** convert the review's assertions into executable truth — registry-verified provider facts, an adversarial seed, sanitized real captures as fixtures, and an *expected-red* test suite — with **zero behavior changes**. The red tests become M12–M14's acceptance criteria.

**Rails (unchanged):** all tool reads stay read-only (Read-Only Admin SSWS). Seed applies need the write token and are run by the human only. Anything committed from a real tenant is SANITIZED first (fake ids/names, structure preserved 1:1) — never raw exports (CLAUDE.md safety rail).

### Phase A — provider fact check (docs only, no tenant) ✅
- [x] Enumerate every `okta_app_*` resource in the okta/okta **v4.20.0** registry docs; classify app vs non-app; record the table (below).
- [x] Confirm whether `okta_app_access_policy_assignment` exists in v4.20.0 and its state shape (`app_id`, `policy_id`).
- [x] Confirm `okta_policy_signon` carries `priority` + `status` in state; confirm `okta_group_rule.status` and app `status`.
- [x] Confirm the Okta semantics to encode later: INACTIVE policies/rules are not evaluated; DEACTIVATED apps are unreachable; sign-on policies evaluate in priority order; `GET /users/{id}/appLinks` reflects individual + group assignment (the admin-console view M7 validated against).

#### Fact table (source: okta/okta provider docs @ tag `v4.20.0`, `docs/resources/*.md`)

**Every `okta_app_*` resource, classified.** APP = an application object → should be an `App` node. NON-APP = a sub-resource/assignment/policy/schema of an app → must NOT become an App node.

| Resource (`okta_…`) | Class | Note |
|---|---|---|
| `app_auto_login` | **APP** | SWA auto-login app |
| `app_basic_auth` | **APP** | Basic-auth app |
| `app_bookmark` | **APP** | Bookmark app |
| `app_oauth` | **APP** | OIDC app |
| `app_saml` | **APP** | SAML app |
| `app_secure_password_store` | **APP** | Secure-password-store app |
| `app_shared_credentials` | **APP** | SWA shared-credentials app |
| `app_swa` | **APP** | Plugin SWA app |
| `app_three_field` | **APP** | Three-field SWA app |
| `app_access_policy_assignment` | NON-APP | Attaches an access policy to an app → **`protects` edge source** (`app_id`,`policy_id`). Missed today. |
| `app_group_assignment` | NON-APP | group→app (single). *In denylist.* |
| `app_group_assignments` | NON-APP | group→app (plural). *In denylist.* |
| `app_signon_policy` | NON-APP | **AppAuthPolicy** node (a policy, not an app). *In denylist.* |
| `app_signon_policy_rule` | NON-APP | Rule of that policy (M15). *In denylist.* |
| `app_user` | NON-APP | **Individual user→app assignment** (unmodeled channel; M12 counts it). |
| `app_oauth_api_scope` | NON-APP | Scope grant on an OIDC app |
| `app_oauth_post_logout_redirect_uri` | NON-APP | OIDC config |
| `app_oauth_redirect_uri` | NON-APP | OIDC config |
| `app_oauth_role_assignment` | NON-APP | Admin-role grant on an app |
| `app_saml_app_settings` | NON-APP | SAML config blob |
| `app_user_base_schema_property` | NON-APP | App user-profile schema |
| `app_user_schema_property` | NON-APP | App user-profile schema |

**Denylist gap (drives the M12 fix + a Phase D red):** the current `APP_TYPE_DENYLIST` (`parse-tfstate.ts`) holds only the 4 *In denylist* rows above. The other **9 NON-APP lookalikes** — `app_access_policy_assignment`, `app_user`, `app_oauth_api_scope`, `app_oauth_post_logout_redirect_uri`, `app_oauth_redirect_uri`, `app_oauth_role_assignment`, `app_saml_app_settings`, `app_user_base_schema_property`, `app_user_schema_property` — currently pass `isAppType()` and become **junk App nodes**. M12's ALLOWLIST (the 9 APP rows) is the fix.

**Schema shapes confirmed (v4.20.0):**
- `okta_app_access_policy_assignment` **exists**. Required `app_id` (immutable) + `policy_id`; read-only `id` == the app id.
- `okta_policy_signon`: `priority` (Optional — "API defaults to last/lowest if absent") and `status` (`ACTIVE`|`INACTIVE`, default `ACTIVE`) both present.
- `okta_group_rule.status` present (default `ACTIVE`). App `status` present on `okta_app_oauth` (default `ACTIVE`; drives activate/deactivate on apply).

**Okta platform semantics to encode later (M12–M13), citations recorded:**
- `GET /users/{id}/appLinks` returns appLinks for **all direct *and* indirect (via group membership) assigned apps** — the exact admin-console view M7 validated against ([Okta User Resources API](https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserResources/)).
- Global session policies + their rules evaluate **in priority order; first applicable/matching rule wins; INACTIVE rules are skipped** ([Global session policy evaluation](https://help.okta.com/oie/en-us/content/topics/identity-engine/policies/osop-evaluation.htm), [Policy & rule prioritization](https://developer.okta.com/docs/guides/policy-rule-prioritization/main/)).
- INACTIVE policies/rules are not evaluated; DEACTIVATED apps are unreachable (standard Okta lifecycle) — encode as "annotate, don't filter" (M12).

### Phase B — adversarial seed (human applies; write token; see seed header)
- [x] Extend `seed/main.tf`: (1) `okta_app_user` — test user → **Salesforce** (granted to no group they belong to); (2) second `okta_policy_signon` **Stricter-Session** (priority 1) vs `default_mfa` (priority 2), both include Engineering; (3) INACTIVE `okta_group_rule` **inactive-contractor-rule**; (4) **Confluence** app managed via plural `okta_app_group_assignments` (single resource, one `group` block). *Authored; each construct has an inline comment naming the red it triggers.*
- [ ] **Human:** `terraform apply` (also applies M10's Wiki app), export `terraform show -json` (gitignored), then add ONE click-ops group to **Confluence** in the console — the M14 drift probe.

### Phase C — capture + ground truth (read-only token)
- [x] `npm run smoke` → sanitize `generated/okta-captures/` → commit as `fixtures/api-real/` (structure-true, fake values). Keep the idealized `fixtures/api/` for the existing unit oracles. *Done via `scripts/sanitize-captures.ts` (committed, auditable, no secrets): one shared id map across the 6 captures + the state so an id means the same thing on both paths; scrubs org subdomain, Okta ids, signing `kid`, and the 5 real `client_secret`s; a leak guard fails the run if any real value survives. Names/labels were already seed-synthetic.*
- [x] Sanitize the state export the same way and commit it (needs a second explicit `.gitignore` exception, like the sample fixture). *Committed at `fixtures/api-real/tenant.tfstate.json` with its own `!`-exception; the RAW `fixtures/real-tenant.tfstate.json` stays gitignored.*
- [x] **M10 leftover:** `outliers --source okta` flags GitHub weaker-than-peers; matches the admin console. **GREEN after the seed fix + re-apply (2026-07-11):** live output is `GitHub — org default — weaker-than-peers — in Engineering (4 apps): 3/4 peers behind Strict-Auth`. Fixtures regenerated.
- [x] Record the console's answers (API-derived below; **human confirms against the admin console**): the test user's full app list (incl. the individual assignment), the effective session policy for an Engineering user, the INACTIVE rule's effect, and which built-in apps appear in `/api/v1/apps`.

#### Phase C ground-truth record (from the sanitized captures @ 2026-07-10; console-confirm the ✎ rows)

Seed applied (Phase B done): live shows the INACTIVE `inactive-contractor-rule`, `Stricter-Session` (prio 1) / `Default-MFA` (prio 2), Salesforce (no group), Confluence via plural, Wiki. The click-ops drift group on Confluence = **Contractors** (live + exported state both carry it).

| Question | API-derived answer | Tool today | Predicted red (Phase D) |
|---|---|---|---|
| Test user's full app list | GitHub, Datadog, Wiki, Confluence (via **Engineering**) **+ Salesforce (individual `okta_app_user`)** = **5** ✎ | group-union trace → **4** (omits Salesforce) | user trace misses the individual assignment (M12/M13) |
| Effective session policy for an Engineering user | **Stricter-Session** (priority 1 wins over Default-MFA priority 2) ✎ | first-edge-wins (address order) → **Default-MFA** | wrong/ambiguous session policy under priority (M12) |
| INACTIVE `inactive-contractor-rule` effect | Okta evaluates it as **nothing** (populates no one) ✎ | parser ignores `status` → phantom `populates` edge to Contractors | INACTIVE treated as active (M12) |
| Built-in apps in `/api/v1/apps` | capture returned **only the 5 managed OIDC apps — no built-in Okta apps** (Admin Console/Dashboard/Browser Plugin appear only as `ACCESS_POLICY` objects, not as apps) ✎ | n/a | "built-ins reported as gaps" may **not** reproduce in this tenant — verify in console before writing that Phase D red (M14) |

#### M10 outlier collision — RESOLVED (seed fix + re-apply, 2026-07-11)

> **Decision (2026-07-10):** fix the seed + re-apply (chosen over recording as not-reproduced). `seed/main.tf` now puts Confluence behind Strict-Auth; the human re-applied, re-exported, and re-added the click-ops Contractors group; fixtures were regenerated. `outliers --source okta` now flags GitHub (3/4 Strict-Auth-dominant Engineering peer set). Green.

Original diagnosis (deterministic, reproduced from the pre-fix fixtures):

`outliers --source okta` reports **(no outliers)**. Cause: the **Engineering** peer set is now `{GitHub, Datadog, Wiki, Confluence}` = Strict-Auth×2 (Datadog, Wiki) vs org-default×2 (GitHub, Confluence) — a **2-2 tie**, so `dominantPolicy` returns none (needs a *unique* ≥2/3 mode). The seed's M10 comment (seed/main.tf:77–79) assumed Engineering = `{GitHub, Datadog, Wiki}` (Strict-Auth 2/3 dominant → GitHub flagged), but Phase B construct (4) added **Confluence to Engineering at org-default**, diluting the majority. This is inherent to the seed as authored (independent of the console-drift step); the tool is behaving correctly (a genuine tie is not an outlier). Contractors peer set = `{GitHub, Confluence}` = 2 apps < MIN_PEERS, so it can't rescue the demo. **Fix if we want the M10 live demo back:** give Confluence the Strict-Auth policy (one line: `authentication_policy = okta_app_signon_policy.strict_auth.id`) → Engineering = 3 custom / 1 default → GitHub flags weaker-than-peers again; needs a human re-apply + re-export + re-sanitize. Does not affect the M14 drift probe.

### Phase D — the expected-red suite ✅
- [x] Equivalence/coverage/trace tests against `fixtures/api-real/` + the sanitized state, using `it.fails` where the review predicts divergence. Committed as `test/expected-red.test.ts` (loaders added to `test/fixture.ts`): **6 `it.fails`** (reproduced reds — green today, flip red when the named milestone fixes them → delete the marker) + **3 documenting `it()`** (predictions that did NOT reproduce, closed below). Existing 168 tests unchanged; suite now 171 passed | 6 expected-fail (177).
- [x] Checkpoint: predicted-vs-observed discrepancy table (below). The 3 non-reproducing predictions are closed with notes.

#### Phase D checkpoint — predicted vs observed (against the committed `fixtures/api-real/`)

Ground truth = the Phase C record. "Observed" = what the tool does today via the real fixtures.

| # | Review prediction | Observed on `fixtures/api-real/` | Verdict | Test |
|---|---|---|---|---|
| 1 | junk App nodes from `okta_app_*` lookalikes | `okta_app_user` (test user→Salesforce) becomes a 6th App node, empty name | **reproduced** → M12 allowlist | `it.fails` |
| 1b | …and pollutes coverage | that junk node is state-only → misreported as a **`stale` App** | **reproduced** → M12 | `it.fails` |
| 3 | wrong/ambiguous session policy under priority | Engineering trace picks **Default-MFA** (prio 2); truth = **Stricter-Session** (prio 1). Live path happens to pick correctly → the two paths **disagree** | **reproduced** → M12 | `it.fails` |
| 4 | INACTIVE rule treated as active | `inactive-contractor-rule` (INACTIVE) emits a phantom `populates`→Contractors, surfacing as a rule feeding GitHub | **reproduced** → M12 | `it.fails` |
| 7 | user trace misses the individual assignment | `traceUser(test.user, [Engineering])` → 4 apps, **omits Salesforce** (the `okta_app_user` channel) | **reproduced** → M12/M13 | `it.fails` |
| 1c | tfstate vs live App-count equivalence | tfstate reports **6** apps, live **5** — equivalence broken by the lookalike | **reproduced** → M12 | `it.fails` |
| 2 | missing `protects` from `okta_app_access_policy_assignment` | **NOT reproduced.** This tenant has no such resource; app auth policies attach via the **inline `authentication_policy`** attribute, which the parser already reads (Strict-Auth→Confluence/Datadog/Wiki all present). | closed | doc `it()` asserts the resource is absent + inline path works |
| 5 | built-ins reported as coverage gaps | **NOT reproduced.** The capture returned only the 5 managed OIDC apps — **no built-in apps** (Admin Console/Dashboard/Plugin appear only as `ACCESS_POLICY` objects). Built-in **groups** (Everyone, Okta Administrators) that DO appear are already correctly **`excluded`**, never `unmanaged`. | closed | doc `it()` |
| 6 | plural `okta_app_group_assignments` absorbs drift → silent 100% | **NOT reproduced — opposite observed.** The committed sanitized state's Confluence plural block holds **only Engineering**, so the click-ops Contractors add (present LIVE) is flagged **`unmanaged`** — coverage *catches* it. See discrepancy note below. | closed (fixture-gated) | doc `it()` locks in the `unmanaged` result |

#### ⚠️ Fixture discrepancy for the M14 drift probe (found in Phase D)

PLAN Phase C (line 81) states the exported state carries the click-ops Contractors group on Confluence ("live + exported state both carry it"). **The committed `fixtures/api-real/tenant.tfstate.json` does NOT** — its `okta_app_group_assignments.confluence_groups` block lists only Engineering, while the live `apps-groups.json` lists Engineering + Contractors. So the state export was evidently taken **before** the click-ops add, and the drift is (correctly) surfaced as an `unmanaged` gap rather than silently absorbed.

Consequence: the M14 silent-absorption red (plural refresh pulls ALL live groups into state → false 100% managed) is **not yet captured by the committed fixture**. To arm it, the human must **re-export `terraform show -json` AFTER the click-ops Contractors add** (the plural resource reads all live groups on refresh, so the re-exported plural block will then carry Contractors), re-sanitize, and recommit. Until then, M14's drift work has no failing fixture to green — track this as an M14 prerequisite, not a Phase D miss.

**Done when:** sanitized real fixtures committed; red suite exists and every red test names the milestone that greens it; M10 live ground truth recorded; provider fact table written; tool behavior unchanged (existing 168 tests still pass).

## Roadmap (rewrite this file per milestone as each starts)

- **M12 — make the graph true.** App-type ALLOWLIST (lookalikes stop becoming Apps; `okta_app_user` presence is COUNTED and surfaced — "N individual assignments present, not modeled" — never silently dropped); `protects` from `okta_app_access_policy_assignment` (if Phase A confirms); carry `status` + session-policy `priority` through parser/model/envelope in ONE widening (one envelope version bump, designed to also fit M15's rule refs); INACTIVE annotated, never filtered (coverage still needs the objects); session policy chosen by priority; "(none)" wording → "org default session policy". Done when: M11's parser/trace reds are green and the live seed trace still matches the console.
- **M13 — make the claims honest.** Relabel strength claims direction-neutral (`weaker-than-peers` → `default-while-peers-custom`; rank-risk weak/strong → a documented divergence prior); user trace gains the `appLinks` diff ("+N via individual assignment", within the users-per-lookup rail); caveats on every gate/severity surface. Phase A (relabel) is independent — pull it forward if anything demo-facing looms. Done when: no output asserts a strength direction the model can't ground; the seeded individually-assigned user's trace matches the console.
- **M14 — make coverage truthful.** Built-in apps excluded (identities derived from the M11 captures, not hardcoded guesses); AppAuthPolicy exclusion keyed to MANAGED/excluded referencing apps (today the comment says "managed" but the code reads ALL live apps); plural-sourced assignment pairs tagged via resource address and annotated "state-tracked; absorbs drift". Done when: live coverage emits no un-importable import block, and the M11 drift probe shows the annotation instead of a silent 100%. **Prerequisite (Phase D finding):** the committed real-tenant state does NOT yet carry the Confluence click-ops drift, so there is no failing silent-absorption fixture — human must re-export state after the click-ops add + re-sanitize first (see Phase D discrepancy note).
- **M15 — policy strength for real** (was "M11 candidate" in the old backlog). Rule capture (`okta_app_signon_policy_rule`; live `GET /policies/{id}/rules`) → factor-based strength bands → upgrade M13's neutral labels to grounded weaker/stronger verdicts with rule evidence shown. Done when: a seeded lax-custom-policy case that the old heuristic would have inverted is ranked correctly, with evidence.

## Nice-to-haves (batch opportunistically; never a milestone)

- Matrix "Other"-fold masking: soften the "never disagree with the table" doc claim now (comment edit); behavior fix only if >6-custom-policy tenants become real.
- `HttpOktaReader`: one 429 retry honoring `Retry-After`; `limit=200` on paginated lists.
- Small-tenant "View app in graph" for org-default outlier apps (currently shows nothing — mars the M10 demo path); `blastLine` rule dedupe.
- `matchSegments` Unicode length edge; `perSideCap` resize — fine to leave indefinitely unless the file is open anyway.

## Explicitly not doing (decided 2026-07-10, revisitable)

- **Bulk individual-assignment modeling** (`/apps/{id}/users` across all apps): violates the users-per-lookup PII rail; the appLinks diff + `okta_app_user` presence signal cover the audit story. Revisit only on real demand.
- **Coverage against CONFIG (plan-JSON) instead of state:** the M14 annotation delivers most of the honesty; config-representation parsing is a large lift for a personal tool. Recorded as the "real" fix if this ever grows users.
- Threshold CLI flags, OEL evaluation, what-if simulation, any WRITE to Okta. Read-only, local, full stop.
