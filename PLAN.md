# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 3 ships, rewrite this for M4.

> **Status of M1 (shipped):** `terraform show -json` -> `ParsedResource[]` -> `OktaGraph` -> `trace()`/`summary`, tested against `fixtures/sample-tenant.tfstate.json`.
>
> **Status of M2 (shipped, merged to main):** live read-only reader (`HttpOktaReader` + pure `mapApiSnapshot`) emits the same `ParsedResource[]`; API-vs-tfstate graph equivalence proven offline; ground-truth acceptance vs the admin console passed on the seeded Integrator tenant (`seed/main.tf`, provider pinned `okta/okta ~> 4.0`). Read-only rail verified live: write probe 403s.

## Milestone 3: IaC coverage — reconcile live tenant vs Terraform state

> **Status (2026-07-02): PHASE A COMPLETE (offline).** All build steps shipped and green (45 tests): step-1 facts pinned against okta/okta v4.20.0; contract deltas (`groupType`/`system` on `ParsedResource`, plural `okta_app_group_assignments` parsing, the `_embedded.resourceType` app-auth guard) with zero graph-layer changes; pure `computeCoverage` classifier and `import-blocks` generator; and the `coverage` CLI (text/JSON, `--imports`, loud missing-creds error). No live network call made. **Phase B (live ground truth) is the remaining work.** PR open for Phase A.

**Goal:** a `coverage` CLI command that reads BOTH inputs — the live tenant (M2 reader) and a `terraform show -json` export (M1 parser) — and answers CLAUDE.md's second differentiated capability: how much of the org is under IaC, what exactly isn't, and ready-to-paste Terraform `import` blocks for the gap. New logic lives in `src/analysis/` (pure, same rule as core) plus a thin CLI/render surface.

**The load-bearing design decision:** the diff operates on `ParsedResource[]` — the same normalized seam both inputs already emit. `computeCoverage(live, state)` is a pure set comparison joined on Okta `id` (composite `(appId, groupId)` for assignments; ids are identical across the two paths by M2's design). If coverage needs a parallel model or reaches back into raw API/tfstate shapes, that's the M2 design smell again — stop and reconsider.

**Scope rails:**

- **Presence/absence only.** A resource is managed, unmanaged, or stale. Attribute-level drift (exists in both, differs inside) is NOT M3.
- **Read-only against Okta, as always.** The tool only reads. `terraform plan`/`apply` in Phase B is the human's seed workflow, not the tool.
- Users are out of scope (no User nodes in the model; `okta_user` in state is ignored, as in M1).

### Classification semantics (the brainwork)

Per kind (Group, App, GroupRule, GlobalSessionPolicy, AppAuthPolicy, AppGroupAssignment), bucket by id:

Per resource, join live and state by id (composite `(appId, groupId)` for assignments) and classify in this ORDER — state presence is decided first; exclusion is only ever a sub-split of the live-only set:

1. **managed** — in live AND state. State presence proves customer IaC intent, so it wins outright: a resource in state is managed even if it also matches an exclusion predicate below. Counts toward coverage.
2. **stale** — in state only (live-absent). Report only (deleted out-of-band, or a stale/foreign state file). Exclusion never applies — stale is by definition live-absent.
3. of the rest (**live only**), split each record:
   - **excluded** — matches an exclusion predicate (not Terraform-manageable / Okta-managed noise). Itemized with reason; NOT counted.
   - **unmanaged** — everything else: the real IaC gap -> import block.

Coverage % = managed / (managed + unmanaged), per kind and overall. Stale and excluded never enter the percentage but are always itemized — nothing is silently dropped.

Ordering is load-bearing: evaluating exclusion before state-presence would misfile a Terraform-managed-but-currently-unattached app auth policy (in both live and state) as `excluded` or `stale`. Because exclusion only partitions live-only records, that policy stays `managed` and the bug can't arise.

**Exclusion predicates (drafted from the live captures in `generated/okta-captures/`; applied ONLY to live-only records; confirm in step 1, review at checkpoint):**

- **Group:** `type !== "OKTA_GROUP"` — `BUILT_IN` (Everyone, Okta Administrators) can't be created via `okta_group`; `APP_GROUP` is app-mastered. (Never in state, so always live-only anyway.)
- **GlobalSessionPolicy:** `system: true` (the tenant "Default Policy").
- **AppAuthPolicy:** `system: true` is already dropped by the M2 mapper as org-default machinery (that stays). Beyond that: a non-system policy referenced by NO visible app's `authenticationPolicyId` — on a fresh tenant the ~5 Okta-created console policies ("Okta Admin Console", "Okta Dashboard", …) protecting first-party apps `/api/v1/apps` doesn't list. Since this runs only on live-only records, a customer's Terraform-managed policy is already `managed` (it's in state) before this rule is consulted, even when momentarily unattached. Residual trade-off: a policy unattached AND absent from state (a genuinely orphaned click-ops policy) is excluded rather than flagged — visible in the excluded list, just not counted.
- **App:** no predicate needed — first-party Okta apps don't appear in `/api/v1/apps` (verified: fresh tenant listed 0 apps pre-seed).

**Edge cases already flagged for M3, resolved by the scoping above:**

- *Explicit org-default app policy* (from the M2 checkpoint): state app carries `authenticationPolicyId = <system policy id>`, live carries `null`. Presence-only comparison of RESOURCES sees no AppAuthPolicy on either side -> no gap. Pin with a regression test.
- *Plural assignments:* `okta_app_group_assignments` (plural) currently parses to nothing (M1 deferred it). A coverage tool that under-counts state-side assignments for the provider-recommended multi-group pattern would be wrong at its core purpose — so M3 implements plural parsing (one `AppGroupAssignment` per `group` block). Shape is doc-derived until the seed actually uses it; note that inline.

## Phase A — offline (pause at the checkpoint)

1. **Pin the facts.** (a) Skim every file in `generated/okta-captures/` for exclusion-rule surprises beyond the drafted rules. (b) From the registry docs for the pinned provider (`okta/okta ~> 4.0`), confirm and record here: the import ID format per resource type (table below) and the state shape of `okta_app_group_assignments` (`app_id` + `group[]` blocks). CLAUDE.md rule applies: registry docs win over any list, including this one.

   | resource | import id (confirmed v4.20.0) |
   |---|---|
   | `okta_group` | `<group id>` |
   | `okta_app_oauth` / `okta_app_saml` / other `okta_app_*` | `<app id>` |
   | `okta_group_rule` | `<rule id>` |
   | `okta_policy_signon` | `<policy id>` |
   | `okta_app_signon_policy` | `<policy id>` |
   | `okta_app_group_assignment` (singular) | `<app id>/<group id>` |
   | `okta_app_group_assignments` (plural) | `<app id>` (imports ALL group blocks) |

### Step 1 findings — facts pinned (recorded 2026-07-02)

**Provider version.** Latest 4.x is **4.20.0** (Terraform Registry versions API); the current major line is 6.13.0. Per CLAUDE.md, v4.20.0 docs are the source of truth — NOT "latest" (6.x docs would be the cross-major trap). All import/shape facts below are quoted from the okta/okta **v4.20.0** resource docs.

**Import IDs — every drafted row CONFIRMED verbatim** (see the table above; `terraform import <resource>.example <id>` for each). Added the plural resource: `okta_app_group_assignments` imports by **`<app_id>`** and pulls in ALL of that app's group blocks. Consequence for step 4: import-block generation for assignment GAPS must target the **singular** `okta_app_group_assignment` (one `import{}` per (app,group) pair, id `<app_id>/<group_id>`) — the plural granularity is wrong for a per-pair gap. Step 4 already specifies the singular form; confirmed correct.

**Plural `okta_app_group_assignments` state shape CONFIRMED (v4.20.0).** Top-level `app_id` (string) + a `group` **block list**; each `group` block = `id` (string, required — the group id), `priority` (number, optional), `profile` (string JSON, optional). In `terraform show -json`, `values.group` is an array. Step-2 parser: emit one `AppGroupAssignment` per `(values.app_id, values.group[i].id)`. (Contrast the singular resource: flat `values.app_id` + `values.group_id`.)

**Exclusion predicates CONFIRMED against `generated/okta-captures/`**, with exact live enumeration:
- **Groups (4):** Contractors + Engineering (`OKTA_GROUP`); Everyone + Okta Administrators (`BUILT_IN`). No `APP_GROUP` present. `type !== "OKTA_GROUP"` excludes the 2 BUILT_IN. NB `objectClass` is `["okta:user_group"]` for ALL four incl. BUILT_IN — `type` is the only correct discriminator, not `objectClass`.
- **OKTA_SIGN_ON policies (2):** Default-MFA (`system:false`, custom → managed); Default Policy (`system:true`, applies to Everyone, priority 2 → excluded). `exclude system:true` confirmed.
- **ACCESS_POLICY policies (7):** "Any two factors" (`system:true`, org default — GitHub points here → mapper nulls it, emits no node); Strict-Auth (`system:false`, custom — Datadog points here → managed); and **exactly 5** Okta-created `system:false` policies referenced by no visible app → excluded: Okta Admin Console, Okta Dashboard, Okta Browser Plugin, Okta Account Management Policy, Okta OIN Submission Tester. The drafted "~5 console policies" is precisely 5.

**Surprise #1 (flag for checkpoint decision).** "Okta Account Management Policy" comes back from `type=ACCESS_POLICY` but carries `_embedded.resourceType: "END_USER_ACCOUNT_MANAGEMENT"` — it is NOT an app sign-on policy (it governs authenticator enrollment / password reset / unlock). The drafted "unattached to any visible app" predicate already excludes it correctly (no app references it), so coverage is right WITHOUT special-casing. Open question: also filter `AppAuthPolicy` emission/counting on `_embedded.resourceType === "APP"` for semantic precision (and cleaner live summaries)? That needs `_embedded.resourceType` added to `RawPolicy` (not captured today). **DECIDED (checkpoint 2026-07-02): add the resourceType guard in `map-api.ts`** — emit `AppAuthPolicy` only when `_embedded.resourceType === "APP"`, treating a MISSING `resourceType` as APP (back-compat with the doc-derived fixtures, which omit `_embedded`). The unattached predicate stays the coverage mechanism; the guard just keeps non-app access policies (END_USER_ACCOUNT_MANAGEMENT etc.) out of the node set and live summaries. Needs `_embedded?: { resourceType?: string }` on `RawPolicy`.

**Surprise #2 (minor, no action).** Apps carry `_links.profileEnrollment` (a `PROFILE_ENROLLMENT` policy) alongside `_links.accessPolicy`. The reader queries only `type=ACCESS_POLICY` + `type=OKTA_SIGN_ON` and the mapper reads only `accessPolicy`, so profile-enrollment policies never enter the dataset. Pinned here so the extra link isn't mistaken for a gap later.

--- CHECKPOINT: review the confirmed exclusion rules + import-id formats with me before implementing. ---

2. **Contract deltas — the one sanctioned touch to existing modules, additive only.** Coverage needs two flags that die before reaching `ParsedResource` today:
   - `parse-tfstate.ts`: add optional `groupType?: string` (Group) and `system?: boolean` (GlobalSessionPolicy) to the union — the tfstate parser leaves both unset (state contents are definitionally customer-managed). Implement the plural-assignments case (replacing the `return null`).
   - `okta-api.ts`: add `type?: string` to `RawGroup` (live-verified values: `OKTA_GROUP` / `BUILT_IN` / `APP_GROUP`) and `_embedded?: { resourceType?: string }` to `RawPolicy` (the Surprise-#1 guard).
   - `map-api.ts`: populate both new fields, and gate `AppAuthPolicy` emission on `_embedded.resourceType === "APP"` (missing == APP, so the doc-derived M2 fixtures still emit Strict-Auth). No M2 test breaks: `test/map-api.test.ts` compares at the graph level (`comparable()` strips these fields; `build-graph.ts` never puts them on nodes) and otherwise via `toMatchObject` (partial), and the tfstate path leaves them unset — so the API-vs-tfstate equivalence stays green with no edit.
   - `model.ts` / `build-graph.ts` / `access-paths.ts`: ZERO changes — the new fields never reach graph nodes. If they need to, that's the smell; stop.
3. **`src/analysis/coverage.ts` — pure classifier.** `computeCoverage(live: ParsedResource[], state: ParsedResource[]): CoverageReport` implementing the table above. No I/O, no network — the architecture principle extends to `src/analysis/`.
4. **`src/analysis/import-blocks.ts` — pure generator.** (CLAUDE.md's structure lists only `coverage.ts`; splitting TF-block rendering out from classification is a deliberate extension of that illustrative layout — both modules stay pure.) Unmanaged records -> Terraform 1.5+ `import` blocks. Resource type comes off the record (`App.appType` is already the TF type on both paths); label = sanitized display name (lowercase, `[^a-z0-9_]` -> `_`, prefix if digit-leading, dedupe collisions); assignments labeled `<app>_<group>` with id `<appId>/<groupId>` (names resolved from the live Group/App records). An app whose `appType` is `okta_app_unknown:<mode>` gets a commented-out block naming the unmapped mode — never a guessed type.
5. **CLI: `coverage` command.** It needs both inputs, so no `--source` option: `--state <path>` (required) plus the live side from env, reusing M2's inert-without-creds behavior (missing env vars -> the existing loud error, exit code 1; missing `--state` -> clear error). Output: text report (per-kind counts, percentages, itemized gaps/stale/excluded with reasons, import blocks when gaps exist) and `--json`. Optional `--imports <path>` writes the blocks as a `.tf` file (file I/O stays in cli/render, not analysis); default such output under `generated/` (gitignored) — writing into `seed/` is only for the deliberate Phase B plan test.
6. **Tests, then `npm test` green — show actual output.** The oracle below, plus both CLI error paths.

### Test oracle for Phase A (defines "correct" offline)

`fixtures/api/*` and `fixtures/sample-tenant.tfstate.json` describe the SAME logical tenant (proven graph-equivalent in M2), so they are the coverage baseline. Coverage-specific cases build enriched copies IN-TEST — never edit the shared fixtures; the M2 equivalence test depends on them.

- **Baseline** (api fixtures as live, tfstate fixture as state): managed per kind = Groups 2/2, Apps 2/2, GroupRules 1/1, GlobalSessionPolicies 1/1, AppAuthPolicies 1/1, Assignments 3/3; unmanaged 0, stale 0, excluded 0; overall **10/10 = 100%**.
- **Noise injection** (live side plus: Everyone `BUILT_IN` group; `system: true` "Default Policy" session policy; unattached "Okta Dashboard" access policy): still 100%; excluded itemizes exactly those 3, each with its reason.
- **Gap injection** (live side plus: group `g-ops` "Click-Ops"; app `a-slack` "Slack" OPENID_CONNECT; assignment `a-gh <- g-ops`): unmanaged is exactly those 3; Groups 2/3, Apps 2/3, Assignments 3/4, overall 10/13; import blocks snapshot-match: `okta_group.click_ops` id `g-ops`, `okta_app_oauth.slack` id `a-slack`, `okta_app_group_assignment.github_click_ops` id `a-gh/g-ops`.
- **Stale injection** (state side plus a group that isn't live): stale itemizes it; percentages unchanged (still 10/10).
- **Explicit-default regression** (state app with `authenticationPolicyId: "p-default"`, live `null`): zero AppAuthPolicy gap or stale.
- **Managed-unattached-policy regression** (a custom app auth policy present in BOTH state and live but attached to no visible app): classifies as `managed` — not `excluded`, not `stale`. Locks in the state-presence-before-exclusion ordering.
- **Plural parsing** (doc-derived state fixture using `okta_app_group_assignments` for `a-gh` -> `g-eng` + `g-con`): yields 2 assignment records; coverage identical to the singular form.

### Phase A done when

- Facts pinned and checkpoint passed; contract deltas in with zero graph-layer changes; `coverage.ts` + `import-blocks.ts` pure and tested; `coverage` CLI wired with loud missing-input errors; `npm test` green including every oracle row; still no write path anywhere in the tool.

## Phase B — live ground truth (needs the tenant + admin console; do this with me)

1. Export real state: `cd seed && terraform show -json > ../generated/seed-state.json` (git-ignored).
2. `npm run dev -- coverage --state generated/seed-state.json` -> expect **100%**, stale 0; excluded itemizes Everyone + Okta Administrators (BUILT_IN), Default Policy (system session policy), and the Okta-created console access policies — and nothing else. Any surprise = a bug or a wrong exclusion rule; investigate before proceeding.
3. **Click-ops gap:** in the admin console, create a group ("Click-Ops Test") and assign the GitHub app to it. Re-run coverage -> exactly 1 unmanaged group + 1 unmanaged assignment, with import blocks.
4. **Prove the blocks:** drop them into `seed/imports.tf`, run `terraform plan -generate-config-out=imported.tf` -> the plan shows exactly "2 to import" and no other changes. That plan output is the acceptance criterion for generated blocks.
5. **Restore the baseline** either way: `terraform apply` the import (brings the click-ops resources under IaC) OR delete them in the console and discard the blocks. Re-run coverage -> 100% again, stale 0.
6. Record any quirks discovered (shapes, exclusion surprises) here, pinned like the provider notes in CLAUDE.md.

## Deferred (do NOT build in M3)

- **Attribute-level drift** — exists-in-both-but-differs (e.g. state says SAML, live says OIDC for the same id). Presence only.
- Generating full resource config — import blocks only; `terraform plan -generate-config-out` owns config generation.
- User-level resources and kinds outside the model: `okta_user`, per-user app assignments, group memberships, admin roles, auth servers, IdPs, network zones, …
- Remediation for stale state (`removed` blocks, state surgery) — report only.
- OEL evaluation; web viz (likely M4 — decide when M3 ships); ANY write operation against Okta.
