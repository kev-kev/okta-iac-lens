# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 15 ships, rewrite this for M16.

> **Shipped:** **M1** static trace. **M2** live read-only reader. **M3** `coverage` + import blocks. **M4** static web viewer. **M5** coverage overlay + recommended steps. **M6** scale (query-first landing + bounded focus). **M7** user-level access trace. **M8** risk ranking. **M9** local read-only server + visual user trace. **M10** policy outliers + Group×Policy heatmap. **M11** validation hardening (provider fact table, adversarial seed, sanitized real fixtures, expected-red suite). **M12** made the graph *true* (allowlist, priority, INACTIVE, individual assignments). **M13** made the claims honest (direction-neutral priors + individual assignments in the user trace). **M14** made coverage truthful (plural `viaPluralResource` provenance end-to-end with the absorbs-drift caveat; AppAuthPolicy exclusion re-keyed to Terraform-manageable referencing apps; capture-verified built-in identities; red #8 greened; live check matched the console 2026-07-18). Suite: 226 passed | 0 expected-fail.

## Context: why M15

M13 replaced fabricated strength directions with direction-neutral priors and stamped every policy-comparison surface with "prior, not proof" caveats. Those caveats are a promissory note: the tool still cannot say *why* one policy is stricter than another, because it never reads policy **rules**. M12 laid the substrate (`status`/`priority` on both policy kinds); M15 cashes the note:

1. **Capture rules.** tfstate: `okta_app_signon_policy_rule` (+ confirm whether `okta_policy_rule_signon` for global session rules is in scope or deferred). Live: `GET /api/v1/policies/{policyId}/rules`.
2. **Derive strength from rule contents** — factor/assurance constraints, access DENY, re-auth frequency — into a small set of ordered strength bands.
3. **Replace priors with grounded verdicts + evidence** wherever rules were actually captured; keep the M13 prior wording wherever they weren't. Never claim evidence that wasn't read (the M13/M14 honesty rule, applied forward).

## Milestone 15: policy strength for real

**Goal:** every weaker/stronger verdict in outliers, heatmap, risk, and trace surfaces is backed by captured rule evidence (named rule, named factor gap) or explicitly remains a prior. No surface claims rule knowledge the snapshot doesn't contain.

**Rails (unchanged):** `src/core` + `src/analysis` stay pure. All tool reads read-only (`GET /policies/{id}/rules` is a plain read under `okta.policies.read`). Verify resource/attribute shapes against the pinned provider (okta/okta v4.20.0) registry docs and a live capture BEFORE coding the parser — the M11 fact-table lesson. Never commit unsanitized captures. `ENVELOPE_VERSION` bump only if rule refs cannot ride as additive-optional fields — decide in Phase 0, date the break in the PR if bumped.

### Phase 0 — design + ground truth (do first; the strength model is unverified until this lands)

- Registry docs: exact attribute shapes of `okta_app_signon_policy_rule` in v4.20.0 (constraints blocks, `access`, `factor_mode`, re-auth settings).
- Live capture: `GET /policies/{id}/rules` for Strict-Auth + the org-default policy in the Integrator tenant; record raw shapes (`verificationMethod`, `constraints`, knowledge/possession, phishing-resistant / hardware-protected flags).
- Seed: add at least one deliberately WEAK rule (e.g. password-only / 1FA) and one DENY rule via Terraform, so the strength ordering has real spread to classify. Re-capture, sanitize (sha1 id-mapping keeps fixture ids stable), inspect the leak guard.
- **Output:** a short fact table in this file (M11 pattern) mapping observed rule JSON → proposed strength bands, before any parser code.

#### Phase 0 findings (2026-07-19) — shapes verified vs docs; live capture PENDING

Two design forks were resolved to their recommended defaults (both **revisitable** — flagged here so a reversal is a localized change, not a rewrite):

- **D1 — band model = weakest-ALLOW FLOOR.** A policy's strength band = the weakest assurance any *ACTIVE ALLOW* rule permits (the easiest documented way in). Honest lower bound, needs no rule-condition evaluation, and matches the tool's existing stance ("the weakest gate is the effective exposure", `policy-outliers.ts`). The band cites the specific rule as evidence; DENY rules are recorded but do **not** set the floor. This deliberately **deviates from the "priority picks the effective rule" wording above** — priority is not used to pick a single winning rule (that needs conditions we never read); it only identifies the system catch-all and breaks evidence-citation ties. *If reversed to "effective = top-priority rule":* only `policy-strength.ts`'s floor reducer + its property tests change.
- **D2 — global session-policy rules (`okta_policy_rule_signon`) = DEFERRED.** M15 scopes to APP auth policy rule strength only. The session-gate surfaces (risk `session-policy` label, trace "session gate") keep their M13 prior wording. Session-rule strength is a fast-follow (its bands — `mfa_required`, `session_lifetime`, `primary_factor` — don't map onto the app-auth factor bands anyway). *If un-deferred:* additive — a second capture + parser variant + a separate band set; nothing in the app-auth path changes.

**Verified rule shapes** (okta/okta v4.20.0 registry + Okta API docs + a practitioner capture — a live capture from *this* tenant still verifies field presence):

- **tfstate** `okta_app_signon_policy_rule`: `access` (`ALLOW`|`DENY`), `factor_mode` (`1FA`|`2FA`), `type` (`ASSURANCE`|…), `re_authentication_frequency` (ISO-8601, e.g. `PT0S`/`PT12H`), `inactivity_period`, `priority`, `status`, and `constraints` — a **List of String**, each element a `jsonencode()`'d authenticator-class object.
- **live** `GET /policies/{id}/rules` → per rule: `actions.appSignOn.access` and `actions.appSignOn.verificationMethod` = `{ factorMode, type, reauthenticateIn, constraints: [ { knowledge:{types,reauthenticateIn}, possession:{deviceBound,hardwareProtection,phishingResistant,userPresence,methods} } ] }`. Constraints are **nested objects live, JSON-strings in tfstate** — the parser and mapper must normalize both to one internal shape.
- **Two asymmetries (honest, documented, not bugs):** (a) the **system catch-all** rule (`system:true`, lowest priority) is *always* returned live but is *absent* from tfstate (unmanaged) — so a policy with zero custom rules is `unknown` on the tfstate path yet has ≥1 readable rule live; this is a known equivalence-oracle divergence and the natural home of the `unknown` band. (b) constraints encoding, per above.

**Fact table — observed rule JSON → strength band** (floor model; bands ordered strongest→weakest, `unknown` incomparable):

| # | Live `actions.appSignOn` | tfstate `okta_app_signon_policy_rule` | Per-rule classification |
|---|---|---|---|
| 1 | `access:"DENY"` | `access="DENY"` | **DENY** — recorded as evidence; does not set the floor |
| 2 | `access:"ALLOW"`, `verificationMethod.factorMode:"1FA"` | `access="ALLOW"`, `factor_mode="1FA"` | **single-factor** |
| 3 | `access:"ALLOW"`, `factorMode:"2FA"`, no `phishingResistant`/`hardwareProtection` REQUIRED | `access="ALLOW"`, `factor_mode="2FA"`, constraints w/o those flags | **two-factor** |
| 4 | `access:"ALLOW"`, `factorMode:"2FA"`, some `constraints[].possession.phishingResistant="REQUIRED"` **or** `hardwareProtection="REQUIRED"` | same via `jsonencode({possession={phishingResistant="REQUIRED"…}})` | **phishing-resistant-2fa** |
| 5 | `factorMode` present but unrecognized / rule shape unclassifiable | ditto | **unknown** (never guess) |

Per-**policy** band = the **weakest band among its ACTIVE ALLOW rules** (2 < 3 < 4). Special cases: ACTIVE rules exist but **none ALLOW** (all DENY) → `deny-all` (strongest); **no readable ACTIVE rules** (e.g. tfstate policy with only the unmanaged catch-all) → `unknown`. INACTIVE rules are excluded (the M12 rule). Ordinal for comparison: `deny-all`(4) > `phishing-resistant-2fa`(3) > `two-factor`(2) > `single-factor`(1); `unknown` compares to nothing.

**Phase 0 status: COMPLETE (2026-07-20).** shapes verified vs docs + live capture ✅ · seed rules applied — 5a (phishing-resistant 2FA) + 5b (1FA bypass); **5c DENY dropped** (OFF_NETWORK invalid once MULTIPLE_NETWORK_ZONES is enabled; `deny-all` → synthetic Phase B tests) ✅ · capture plumbing (`HttpOktaReader.listPolicyRules`, `live-smoke`, `sanitize-captures`) ✅ · fixtures regenerated + sanitized, 226 green ✅ · committed on `m15-policy-strength` (6278005, 3d918cc). Phase A next.

**Phase 0 LIVE CONFIRMATION (2026-07-19 capture, `integrator-1546176`):** ALLOW-band shapes match the fact table end-to-end. Findings that refine the model:

- **The kicker is real.** Strict-Auth → floor `single-factor` (weakest ALLOW = "Contractors-Password-Bypass", 1FA); org default "Any two factors" (system) → `two-factor`. Apps behind Strict-Auth therefore floor *weaker* than GitHub (org default): the org-default-is-looser prior is **inverted** by evidence → **arm this as the Phase C red**.
- **System catch-all confirmed always-present live** (`system:true`, `priority:99`, `ALLOW`), absent from tfstate. So org-default and any all-catch-all policy band `unknown` on the tfstate path (documented divergence, not a bug).
- **New factorMode value observed: `2FA_If_Possible`** (Okta Account Management Policy — an Identity-Engine value; the plan's Known-Risk-1 made real). Semantics = 2FA when enrolled else 1FA fallback → floor `single-factor` (conservative; flagged in evidence). Truly unrecognized factorModes → `unknown`, never guessed. Parser must not crash on unknown values.
- **Evidence must carry the deciding rule's SCOPE.** The 1FA floor rule is scoped to group Contractors (no Contractor is assigned to Datadog/Wiki), so the floor is a POLICY property, not proof every app is reachable at 1FA. Phase B threads `groups_included`/`network_connection` into the evidence so the band stays honest without evaluating conditions.
- **Org-default band source:** the system "Any two factors" policy's rules ARE captured (keyed by its id); the strength model maps `authenticationPolicyId=null` → that policy's band. tfstate lacks them → `unknown` there.
- **DENY row still doc-derived:** the seed's `Block-Off-Network` DENY rule did NOT create on apply (2 of 3 rules landed — see below); diagnosing the HCL/API error before the final capture. DENY→`deny-all` is otherwise covered by synthetic Phase B property tests.
- **Fact-table addendum:** factorMode `2FA_If_Possible` → `single-factor`; any other unrecognized factorMode → `unknown`.

### Phase A — rule capture (parser + reader + mapper)

- `parse-tfstate.ts`: `AppAuthPolicyRule` variant (id, policyId, name, priority, status, + the strength-bearing fields the fact table proves out).
- `okta-api.ts`: `listPolicyRules(policyId)` on the reader interface; sequential per-policy fetch (rate-limit posture as with per-app groups). `map-api.ts` emits the same variant.
- Fixture-verification tests both paths against the new captures; graph equivalence oracle extended.

**Phase A status: COMPLETE (2026-07-20).** `AppAuthPolicyRule` is a `ParsedResource` variant (NOT a graph node — rules are policy-internal; keeps `NodeKind`/envelope untouched, consumed directly by the Phase B strength model). Both encodings normalize to one `RuleConstraint` shape via a shared `toRuleConstraint` (tfstate `jsonencode` strings JSON.parsed; live nested objects projected) — a malformed constraint string is skipped, never crashes. `listPolicyRules` promoted onto `OktaReader` + folded into `OktaApiSnapshot.policyRules` (one GET per ACCESS_POLICY in `readTenantSnapshot`, sequential); `live-smoke` now sources rules from the snapshot. Mapper emits rules for **APP-typed** access policies only — the system org-default is KEPT (its rules band it) but the `END_USER_ACCOUNT_MANAGEMENT` policy's rules (the `2FA_If_Possible` catch-all) are dropped. New kind threaded through the exhaustive `KIND_TO_TF_TYPE`/`KIND_NOUN` Records and a no-op `build-graph` arm; **rules are INERT on every existing surface** (summary/coverage counts unchanged — verified). Cross-path equivalence proven on the real fixtures: the two managed Strict-Auth rules are field-identical tfstate-vs-live (modulo the live-only system catch-all + provenance address). Suite: **235 passed** (+9) | 0 expected-fail; main + web typecheck clean. Phase B (`policy-strength.ts`) next.

### Phase B — strength model (pure analysis)

- `src/analysis/policy-strength.ts`: rule records → per-policy strength band with per-rule evidence (the band-deciding rule + factor facts). Bands ordered; unreadable/absent rules → `unknown` band, never a guess.
- Property tests: DENY dominates; phishing-resistant 2FA > 2FA > 1FA; INACTIVE rules ignored (M12 rule); priority picks the effective rule.

**Phase B status: COMPLETE (2026-07-20).** `policy-strength.ts` is pure `src/analysis` (consumes the `AppAuthPolicyRule` records directly, not the graph). Public API: `StrengthBand` (`single-factor`<`two-factor`<`phishing-resistant-2fa`<`deny-all`; `unknown` incomparable), `computePolicyStrength(policyId, rules)` → `{band, ordinal, evidence, active/allow/denyRuleCount}`, `policyStrengthIndex(resources)` (groups by policyId), `strengthForPolicy(index, id)` (the single "absent = unknown" site), `compareBands(a,b)` → weaker/stronger/same/incomparable. **D1 reconciled:** the input bullet's "priority picks the effective rule" is SUPERSEDED — the band is the weakest-ALLOW FLOOR; priority never selects a winner (that needs the conditions we don't read), it ONLY breaks evidence-citation ties (property-tested both ways). Evidence carries the deciding rule's SCOPE (`groupsIncluded`/`networkConnection`) so Phase C stays honest without evaluating conditions. Honesty guards: DENY never raises the floor (recorded only); an unclassifiable ALLOW rule → `unknown` UNLESS a proven `single-factor` floor already exists (nothing weaker to hide); unrecognized `access` (neither ALLOW/DENY) can't claim `deny-all`; `2FA_If_Possible` → conservative `single-factor`. Fixture-locked to the capture-verified shapes: **Strict-Auth floors `single-factor` on BOTH paths** (the managed Contractors-Password-Bypass 1FA rule sets it — the live-only catch-all doesn't matter), org-default "Any two factors" = `two-factor` live / `unknown` in tfstate (the documented catch-all divergence), and `compareBands(Strict-Auth, org-default) = weaker` — **the Phase 0 KICKER armed** (org-default-is-looser prior inverted; Phase C's red). Suite: **258 passed** (+23) | 0 expected-fail; main + web typecheck clean. Phase C (grounded verdicts on existing surfaces) next.

### Phase C — grounded verdicts on existing surfaces

- Outliers/heatmap/risk/trace: where both sides have known bands, emit *"weaker: X requires 1FA (rule 'Default'), baseline requires phishing-resistant 2FA (rule 'Strict')"*. Where either side is `unknown`, keep the M13 prior wording verbatim. One shared verdict formatter so surfaces can't drift.
- Red-suite: arm reds for any current surface claim the new evidence contradicts (expect at least one — the M13 priors were deliberately non-committal, but the heatmap divergence prose may overclaim once bands exist).

**Phase C status: COMPLETE (2026-07-21).** ONE shared, pure formatter in `policy-strength.ts` drives every surface (anti-drift): `strengthVerdict(subject, baseline)` (grounded ONLY when both bands known, else `{grounded:false}` → caller keeps the M13 prior VERBATIM), `formatStrengthVerdict` (the `weaker/stronger/same: …, baseline …` line, citing each side's deciding rule + SCOPE), `formatPolicyFloor` (single-gate annotation), `describeBand`. **Org-default plumbing (the crux):** the org-default policy is never a graph node and null-policy apps carry no id, so a new optional `policySystem` flag (set in `map-api` from `systemPolicyIds`, never in tfstate) lets `orgDefaultPolicyId` + `strengthResolver.forPolicyOrDefault(null)` resolve a null-policy app to the system policy's band — live only; tfstate has no system policy → org-default stays `unknown` (the Phase 0 divergence, kept honest). **Surfaces wired (CLI):** `outliers` renders a per-finding `↳` grounded verdict; `risk` adds a `band` column (App gates) + keeps the SCORE on the prior; `trace`/`app-trace`/`user-trace`/`user-app-explain` annotate each gate line with `floor: …`. `rank-risk` gained an additive `gatePolicyId`; `policy-outliers`/`access-paths` stay graph-only (verdicts resolved at render from ids the rows already carry). **The KICKER, realized on real surfaces (live):** GitHub is flagged `default-while-peers-custom`, yet the `↳` verdict reads *"stronger: org default … requires two-factor (2FA) [rule 'Catch-all Rule'], baseline Strict-Auth admits single-factor (1FA) [rule 'Contractors-Password-Bypass', scoped to 1 group]"* — the org-default-is-looser prior INVERTED by evidence, with honest scope. On tfstate the SAME divergence has no verdict and keeps the prior caveat verbatim. **Reds:** greened tests lock the delivered inversion (outliers verdict, risk band, trace floor) + the tfstate-prior fallback; ONE `it.fails` armed — `rank-risk` SCORING still weights org-default 2× so GitHub (2FA) outscores Confluence (1FA), which the bands invert (greens when a milestone scores from bands; Phase C surfaces the band + caveat but does not re-score). **Caveat audit (Phase E rule, partial):** no prior caveat survives on a grounded CLI surface; the prior caveat is retained where still on the prior (outliers tfstate, risk no-strength, and ALL web surfaces — still prior, Phase D grounds them). **DEFERRED to Phase D:** heatmap (`outlier-matrix.ts`) + web panels + JSON structured verdicts — all need the envelope to carry rule/band data (Phase D's explicit decision); Phase C is the analysis + CLI deliverable (Phase D note: "trimmable to CLI-only"). Suite: **271 passed | 1 expected-fail** (+13); main + web typecheck clean. Phase D (viewer + envelope) next.

### Phase D — viewer + envelope

- Decide (from Phase 0) whether rule evidence rides as additive-optional item fields (`ENVELOPE_VERSION` stays 1) or forces 2. Panel: show band + deciding rule on policy selection.
- Trimmable to CLI-only if over-running — the analysis + CLI verdicts are the deliverable.

**Phase D status: COMPLETE (2026-07-21).** **ENVELOPE DECISION — additive `policyRules`, `ENVELOPE_VERSION` stays 1** (recorded in `envelope.ts`). The captured `AppAuthPolicyRule[]` (the exact set `appAuthPolicyRules(resources)` extracts) ride as a new optional `GraphEnvelope.policyRules`, exactly like the M5 coverage overlay / M12 node fields: a viewer that ignores it renders the graph, an old rule-less envelope still parses. The band could NOT ride as a node field — the org-default policy (the KICKER's subject) has no node — so rules travel at envelope level and the viewer bands them through the **SAME pure `strengthResolver` the CLI uses** (zero CLI/web drift by construction; the established "recompute in browser" pattern). `makeEnvelope` drops an empty rule set (absent == no-rules-captured). Wired into all THREE producers (`export`, `coverage --viz`, the M9 `loadEnvelope`); `parse-envelope` validates + **degrades gracefully** (malformed `policyRules` → dropped + `notice`, graph still renders — the coverage-overlay decision B, extended). **ONE shared anti-drift unit** `outlierStrengthVerdict` (+ shared `ORG_DEFAULT_POLICY_LABEL`) resolves subject-vs-dominant → `{subject, baseline, verdict, line}`; the CLI `↳`, the web panel, and the JSON ALL render through it, so the grounded/prior decision + wording can't diverge. **Viewer:** `PolicyPanel` shows the band + deciding rule for an app-auth policy (the explicit ask; session policies show none — D2 deferred); the outlier table/detail/heatmap caveats are now **adaptive** via one pure `strength-notes.ts` (`verdictRegime` → `prior`/`grounded`/`all-unknown`) — grounded `↳` verdicts on the detail panel, the stale "not a factor-based verdict" phrase kept ONLY where the regime is genuinely a prior (Phase E honesty rule, pre-satisfied on web). **JSON structured verdicts:** `outliers --json` gains a `strength.rows` block (per-row subject band + per-finding `{grounded, direction, baseline}` with each side's full `PolicyStrength`); `risk --json` stamps each App row's `band`/`bandOrdinal`. The SCORE is untouched — the armed rank-risk red stays armed (evidence added, not re-scored). **Verified live-of-fixtures:** tfstate `export` carries the 2 managed rules at version 1; `outliers --json` shows GitHub's org-default subject `unknown` on tfstate → `grounded:false` → prior kept, with the Strict-Auth baseline's single-factor evidence intact; `risk --json` bands the custom gates single-factor, org-default `unknown`. Suite: **288 passed | 1 expected-fail** (+17); main + web typecheck + `web:build` all clean. Phase E (verify + lock: the grep sweep + human console check) next.

### Phase E — verify + lock

- Full suite green, 0 `it.fails`; build + web:typecheck clean.
- Grep: no "prior, not proof" caveat survives on a surface that now carries evidence (the M13/M14 stale-docs lesson) — and none is REMOVED from a surface still running on priors.
- Human live check: verdict for Strict-Auth vs org-default matches what the admin console rule pages show.

**Done when:** every strength verdict names its evidence or explicitly remains a prior; the strength model is locked to capture-verified rule shapes by tests; seed includes weak + DENY rules exercised end-to-end; envelope decision recorded; suite green with 0 expected-fail; live check matches the console.

**Known risks:** (1) rule JSON shape variance (Identity-Engine-only fields) — Phase 0 exists to find this before code. (2) Rule fetch multiplies API calls (one per policy) — small tenant fine; enterprise posture is the existing sequential+paginated pattern, note for the rate-limit nice-to-have. (3) Strength ordering is a judgment call at the margins (e.g. 2FA-any vs 1FA-phishing-resistant) — bands must be few and defensible; ties → same band, never invented direction.

## Roadmap (rewrite this file per milestone as each starts)

**M16 candidates — practitioner adoption (analysis 2026-07-18; pick by value-per-lift when M15 ships):**

- **CI drift gate** (small lift, highest leverage): `coverage --check [--min-coverage N]` → nonzero exit on gaps/stale + a markdown summary artifact. Turns the tool from a one-off inspection into a scheduled control (nightly job catches click-ops drift the morning after). Most of the value of "reconciliation as a practice" for ~a day of work.
- **OAuth service-app auth** (medium lift, removes the biggest enterprise blocker): SSWS tokens are org-wide and inherit their creator; real orgs mandate scoped OAuth (`okta.groups.read` etc., DPoP). The read-only story becomes enforceable by scopes, not by trusting a Read-Only-Admin token. CLAUDE.md already anticipates this switch.
- **Access-review evidence export** (differentiated — nothing else does this): dated, self-contained HTML/CSV report of "who can reach what, via which group/rule/policy, and its IaC status" — direct evidence for SOC2/ISO access-certification. Builds almost entirely on existing trace + coverage.
- **Multi-state merge** (real-org blocker): accept `--state` repeated / a directory; real teams split Terraform across workspaces, so one tenant ↔ many state files. Presence-union is semantically simple; the work is CLI + dedupe rules.
- **Scope honesty at the product level**: the report says "coverage" but classifies 6 kinds; real orgs also manage password policies, MFA enrollment, network zones, admin roles, IdPs in Terraform. Either widen kinds incrementally or print a "measured kinds: …" scope line on every report (cheap, honest, M14's lesson generalized).
- **Distribution**: publishable package (`npx <tool> coverage ...`), 5-minute README quickstart, and the rename off the `okta-` prefix (CLAUDE.md trademark note) — adoption dies at `git clone` + `tsx`.

## Nice-to-haves (batch opportunistically; never a milestone)

- Viewer individual-assignment channel — trimmed from M13 Phase D (2026-07-15). Thread `directApps` through `/api/user-membership` + the vite middleware; render individual apps as app nodes with no group edge. CLI+core already carry the data.
- Assignment reverse-anomaly: group-reached in the graph but live per-app `scope` check 404s → surface as a discrepancy (deprovisioning lag / rule mismatch).
- Matrix "Other"-fold masking: soften the "never disagree with the table" doc claim; behavior fix only if >6-custom-policy tenants become real.
- `HttpOktaReader`: one 429 retry honoring `Retry-After`; `limit=200` on paginated lists. (Relevant to M15's per-policy rule fetches.)
- Small-tenant "View app in graph" for org-default outlier apps; `blastLine` rule dedupe.
- `matchSegments` Unicode length edge; `perSideCap` resize.

## Explicitly not doing (decided 2026-07-10, revisitable)

- **Bulk individual-assignment modeling** (`/apps/{id}/users` across all apps): violates the users-per-lookup PII rail. The per-user `scope` check (M13) + `okta_app_user` presence signal (M12) cover the audit story.
- **Coverage against CONFIG (plan-JSON) instead of state:** M14's annotation delivered the honesty; config parsing is a large lift for a personal tool.
- **Drift *detection* inside the plural resource** (diffing state's `group` blocks against config): requires config parsing; the M14 annotation is the honest, cheap alternative.
- Threshold CLI flags, OEL evaluation, what-if simulation, any WRITE to Okta. Read-only, local, full stop.
