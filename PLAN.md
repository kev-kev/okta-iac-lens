# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 14 ships, rewrite this for M15.

> **Shipped:** **M1** static trace. **M2** live read-only reader. **M3** `coverage` + import blocks. **M4** static web viewer. **M5** coverage overlay + recommended steps. **M6** scale (query-first landing + bounded focus). **M7** user-level access trace. **M8** risk ranking. **M9** local read-only server + visual user trace. **M10** policy outliers + Group×Policy heatmap. **M11** validation hardening (provider fact table, adversarial seed, sanitized real fixtures, expected-red suite). **M12** made the graph *true* (allowlist, priority, INACTIVE, individual assignments). **M13** made the claims honest (direction-neutral priors + individual assignments in the user trace; greened red #7). Suite: 206 passed | 0 expected-fail.

## Context: why M14

M13 made the *strength claims* honest. The coverage report still has three dishonesty problems the M11 review flagged:

1. **The exclusion reason overclaims.** Any live-only `AppAuthPolicy` referenced by no app is excluded as *"Okta-created app access policy attached to no managed app"* (`src/analysis/coverage.ts:190`). A custom orphaned policy would get the same false "Okta-created" label. The built-in console policies (Okta Admin Console / Dashboard / Browser Plugin — `system:false, resourceType:APP` ACCESS_POLICY objects, *not* apps) are excluded only by this fragile heuristic, not by identity.
2. **The exclusion predicate is mis-keyed.** `buildLiveContext` (coverage.ts:158) treats a policy as "in use" if referenced by *any* live app, not by Terraform-manageable referencing apps.
3. **Plural-resource drift absorption is invisible.** `okta_app_group_assignments` re-reads ALL assigned groups on refresh (the CLAUDE.md provider gotcha), so a click-ops assignment gets absorbed into state and reported as `managed` — a silent 100%. Presence-only comparison structurally cannot *detect* this, so the honest deliverable is *annotation*: plural-sourced pairs are tagged and every surface carries an "absorbs drift" caveat.

Also dishonest by proximity: `recommendations.ts:70` hardcodes "Okta built-ins or system config" prose, and `parse-tfstate.ts:229-244` emits identical `AppGroupAssignment` records for singular and plural sources — no provenance to annotate from.

## Milestone 14: make coverage truthful

**Goal:** every coverage bucket, reason string, and 100%-managed claim says only what the data proves. Plural-sourced pairs are flagged end-to-end with an absorbs-drift caveat; AppAuthPolicy exclusion is re-keyed to Terraform-manageable referencing apps with honest reason strings; built-in identities come from the captures and are locked by a test.

**Rails (unchanged):** `src/core` + `src/analysis` stay pure — no I/O, no network. All tool reads read-only. `ENVELOPE_VERSION` stays 1 — additive-optional fields only (`slimCoverage()` rest-spreads item fields; `parse-envelope.ts` checks structure leniently — confirmed safe). Every exclusion reason string must be a provable claim. Never commit unsanitized captures.

### Red this milestone arms AND greens (delete the `.fails` marker when it flips)

| # | Red (goes into `expected-red.test.ts`) | M14 fix |
|---|---|---|
| 8 | absorbed plural click-ops pair (Confluence/Contractors) is `managed` AND annotated `viaPluralResource` | Phase A adds the flag; Phase D lands the regenerated post-click-ops fixtures. Expected-fail under committed fixtures (pair is `unmanaged`) AND under new-fixtures-without-code (managed but unflagged); greens only when both land. |

Red-suite bookkeeping beyond #8: documenting test #6 (`expected-red.test.ts:135`, asserts Confluence/Contractors `unmanaged`) is **rewritten in the same commit as the fixture regen** (Phase D — it breaks the instant fixtures flip); documenting test #5 (`:118`, no built-in apps) is re-verified against the fresh capture; `coverage.test.ts:117`'s reason regex updates in Phase B.

### Key design decisions

- **Provenance flag, one name end-to-end:** `viaPluralResource?: true` on the `AppGroupAssignment` parse variant (set only by the plural arm) and on `CoverageItemBase`. **Subtlety:** managed items embed the *live* record (coverage.ts:277-278), so `computeCoverage` must read the flag from `stateR`, not `liveR`. Managed and stale branches only — unmanaged/excluded are live-only and can never carry it.
- **AppAuthPolicy re-key:** live-only policy → `unmanaged` iff referenced by ≥1 Terraform-manageable live app (in state, or live-only and not excluded); otherwise `excluded` with honest reasons — generic: *"app access policy referenced by no Terraform-manageable app in the live snapshot"*; identity-refined (name in the capture-verified built-in list): *"access policy of Okta built-in console app — not Terraform-manageable"*. Identity **refines the reason string only, never decides the bucket** (a custom policy spoof-named "Okta Dashboard" that a real app references still lands `unmanaged`).
- **"Identities from captures, not hardcoded" made enforceable:** `src/analysis/okta-builtins.ts` (`BUILT_IN_APP_POLICY_NAMES = ["Okta Admin Console", "Okta Dashboard", "Okta Browser Plugin", "Okta OIN Submission Tester"]`) + a fixture-verification test asserting each constant exists in `fixtures/api-real/app-signon-policies.json` with `system:false`/`resourceType:"APP"` and is referenced by no app in `apps.json`. Claim-vs-capture drift fails a test.
- **Built-in APPS:** the capture shows `/api/v1/apps` returns no built-ins in this tenant. Carry `RawApp.name` (catalog slug) through `map-api.ts` as additive-optional `catalogName?: string` on `ParsedResource.App` (live-only, `groupType` precedent). Primary path: fresh capture still shows none → ship NO app exclusion predicate (can't prove identities never observed); extend the documenting test. Contingency: built-ins appear → `BUILT_IN_APP_CATALOG_NAMES` from observed slugs + an App arm in `exclusionReason` keyed on `catalogName`, with its own fixture-verification assertion.
- Bonus testability: **Confluence/Engineering is plural-sourced and managed in today's committed fixtures**, so the annotation pipeline is fully testable before the human tenant step.

---

### Phase 0 — human prerequisite (tenant re-export; do anytime, COMMIT ONLY in Phase D)

In PowerShell, with the Integrator-tenant env vars (same as M11):

```powershell
# 1. Confirm in the admin console that the click-ops Contractors→Confluence assignment is still present.
# 2. Refresh raw API captures into generated/okta-captures/:
npm run smoke
# 3. Pull the click-ops drift INTO state (terraform show alone won't — refresh is required):
cd seed
terraform apply -refresh-only     # review + approve the refresh
terraform show -json | Out-File -Encoding utf8NoBOM ..\fixtures\real-tenant.tfstate.json
cd ..
# 4. Regenerate sanitized fixtures (leak guard runs; sha1 id-mapping keeps existing fixture ids stable):
npx tsx scripts/sanitize-captures.ts
```

Then inspect: (a) the plural block in `fixtures/api-real/tenant.tfstate.json` now contains the Contractors group id; (b) whether `fixtures/api-real/apps.json` gained any built-in apps (decides the Phase B contingency). **Do NOT commit the regenerated fixtures alone** — documenting test #6 breaks the moment they flip; fixtures + test rewrite land together in Phase D.

### Phase A — plural provenance (parser + coverage core)

- `src/core/parse-tfstate.ts`: `AppGroupAssignment` variant gains `viaPluralResource?: true`; set only in the `okta_app_group_assignments` arm (~line 240). Doc comment ties it to the CLAUDE.md provider gotcha.
- `src/analysis/coverage.ts`: `CoverageItemBase` gains `viaPluralResource?: true`; `computeCoverage` copies it from the **state-side** record onto managed and stale items.
- Tests: `parse-tfstate.test.ts` (plural arm flags, singular doesn't); `coverage.test.ts` (managed-via-plural flagged; stale plural flagged; live-only never flagged); `slim-coverage.test.ts` (flag survives slimming); real-fixture positive: Confluence/**Engineering** flagged (works against committed fixtures).
- No impact on `import-blocks.ts` (unmanaged items never carry the flag) or `coverage-badges.ts` (buckets unchanged).

### Phase B — honest exclusion re-key + built-in identities + arm red #8

- New `src/analysis/okta-builtins.ts` + `test/okta-builtins.test.ts` (fixture-verification, as above).
- `src/inputs/map-api.ts`: carry `catalogName: app.name`; `parse-tfstate.ts` App variant gains optional `catalogName?: string` (live-only, doc like `groupType`).
- `src/analysis/coverage.ts`: `buildLiveContext(live, stateAppKeys)` → `manageableReferencedAuthPolicyIds`; rewrite the `AppAuthPolicy` arm of `exclusionReason` with the two honest reason strings; `appExclusionReason()` helper returning null on the primary path (contingency slots in here).
- `src/analysis/recommendations.ts` (~line 70): reword "Okta built-ins or system config" to a provable claim (e.g. *"not Terraform-manageable — each item carries its specific reason"*).
- Tests: update `coverage.test.ts:117` reason regex; new cases — policy referenced only by excluded/absent apps → `excluded`; unreferenced custom-named policy → generic reason (never a built-in claim); built-in-named unreferenced → identity reason; existing managed-but-unattached ordering test stays green. `recommendations.test.ts` prose.
- **Arm red #8** in `expected-red.test.ts`: `it.fails("M14: absorbed plural click-ops pair (Confluence/Contractors) is managed AND annotated viaPluralResource")`.

### Phase C — render surfaces

- `src/render/cli.ts` `renderCoverage`: new section listing flagged pairs — *"State-tracked via okta_app_group_assignments — absorbs click-ops drift (N)"* + one-line caveat: the plural resource re-reads ALL assigned groups on refresh, so click-ops drift is absorbed into state and reported as managed. `--json` carries the flag for free.
- `src/analysis/recommendations.ts`: new info recommendation when flagged items exist (shared source → CLI and viewer can't drift).
- `src/render/web/CoveragePanel.tsx`: small section mirroring the excluded list. **Trimmable to nice-to-have if the phase over-runs** — CLI + recommendation are the deliverable.
- Tests: `cli-coverage.test.ts` (section + caveat-presence assertion, M13 pattern), `recommendations.test.ts`.

### Phase D — fixture flip (needs Phase 0 output; ONE commit)

Regenerated `fixtures/api-real/*` + `fixtures/real-tenant.tfstate.json` **and, in the same commit**:
- Rewrite documenting test #6 (the `unmanaged` assertion is superseded by absorption).
- **Delete the `.fails` marker** on red #8 → move to a greened-reds describe block.
- Re-verify documenting test #5 against the fresh capture; execute the Phase B contingency iff built-in apps appeared.
- `okta-builtins.test.ts` re-verifies constants against the fresh policies capture.

### Phase E — verify + lock

- Full suite green, **0 `it.fails`**; `npm run build` + `npm run web:typecheck` clean.
- Grep: no `"Okta-created app access policy"` literal survives anywhere, **including README** (the M13 stale-docs lesson).
- `ENVELOPE_VERSION === 1` confirmed.
- Human live check: `coverage --source okta` against the tenant — Confluence/Contractors `managed` **with** the plural annotation; console policies `excluded` with the new honest reasons; export → viewer shows the plural section (if the Phase C viewer bit shipped).

**Done when:** red #8 greens (marker deleted) and the suite holds 0 `it.fails`; no exclusion reason makes an unprovable claim and no "Okta-created" literal remains (code, tests, README); plural-sourced pairs carry `viaPluralResource` parser → coverage → CLI/JSON → viewer with the absorbs-drift caveat on every surface that shows them; built-in policy identities are constants verified against the capture by a test; `ENVELOPE_VERSION` stays 1; existing non-red-suite tests stay green; live human check matches the console.

**PR-body note:** `--json` coverage items gain optional `viaPluralResource` and the excluded-reason strings change — the CLI JSON output is an interface; date the break in the PR (M13 precedent).

**Known risks:** (1) whether fresh `/apps` returns built-in apps is unknowable until Phase 0 — contingency planned both ways. (2) `terraform apply -refresh-only` may pull unrelated attribute drift into state — harmless for presence-only comparison, but expect fixture diff churn; the sanitizer leak guard re-runs. (3) Post-absorption, Confluence/Contractors emits no import block (it's "managed") — structural to presence-only coverage; the annotation IS the mitigation.

## Roadmap (rewrite this file per milestone as each starts)

- **M15 — policy strength for real.** Rule capture (`okta_app_signon_policy_rule`; live `GET /policies/{id}/rules`) → factor-based strength bands → grounded weaker/stronger verdicts with evidence. This is what M13's "prior, not proof" caveats promise. Builds on M12's `status`/`priority` substrate; may finally justify an envelope bump for rule refs.
- **Post-M14 note:** the app-entirely-absent-from-Terraform drift story is delivered by M14's coverage honesty work; the M13 pivot note about no pre-M14 surface for click-ops apps closes with this milestone.

## Nice-to-haves (batch opportunistically; never a milestone)

- Viewer individual-assignment channel — trimmed from M13 Phase D (2026-07-15). Thread `directApps` (live per-app `scope: USER` check) through `/api/user-membership` + the vite middleware, and render individual apps as app nodes with no group edge in `user-access-graph.ts`/`buildUserAccessGraph` + `UserTracePanel`. CLI+core already carry the data; this is the browser surface only.
- Assignment reverse-anomaly: group-reached in the graph but the live per-app `scope` check returns 404 (not actually assigned) → surface as a discrepancy (deprovisioning lag / rule mismatch). Small add on top of the scope resolver.
- Matrix "Other"-fold masking: soften the "never disagree with the table" doc claim; behavior fix only if >6-custom-policy tenants become real.
- `HttpOktaReader`: one 429 retry honoring `Retry-After`; `limit=200` on paginated lists.
- Small-tenant "View app in graph" for org-default outlier apps; `blastLine` rule dedupe.
- `matchSegments` Unicode length edge; `perSideCap` resize.

## Explicitly not doing (decided 2026-07-10, revisitable)

- **Bulk individual-assignment modeling** (`/apps/{id}/users` across all apps): violates the users-per-lookup PII rail. The per-user, per-app `scope` check (M13) + `okta_app_user` presence signal (M12) cover the audit story.
- **Coverage against CONFIG (plan-JSON) instead of state:** the M14 annotation delivers most of the honesty; config parsing is a large lift for a personal tool.
- **Drift *detection* inside the plural resource** (diffing state's `group` blocks against config): requires config parsing (see above); the M14 annotation is the honest, cheap alternative.
- Threshold CLI flags, OEL evaluation, what-if simulation, any WRITE to Okta. Read-only, local, full stop.
