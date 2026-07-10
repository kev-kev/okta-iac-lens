# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 10 ships, rewrite this for M11.

> **Shipped:** **M1** static trace. **M2** live read-only reader (graph equivalence + ground truth). **M3** `coverage` reconciliation + import blocks. **M4** static web viewer (policies as card attributes; group-trace + policy-sharing). **M5** coverage overlay + recommended steps. **M6** scale the viewer (query-first landing + cohort overview + bounded depth-1 focus + hub truncation; slim envelope). **M7** user-level access trace (`trace --user`; a user is a trace INPUT, not a graph node; live ground truth; security review clean). **M8** risk-ranked landing + blast-radius (pure `rankRisk` reach × gate × IaC, CLI + viewer sort; O(N+E); security review clean). **M9** local read-only server → live, VISUAL user-access trace in the viewer (Vite middleware; Host/Origin gate; token server-side; security review clean). *(Post-M9, on main: ranked viewer search + match highlighting.)*

## Milestone 10: policy outlier views — divergence edition

**Goal:** surface apps whose auth policy DIVERGES from their peers — backlog #4, the next "opinionated layer" item.

**Design (load-bearing):**
- **The model has no policy CONTENT** (no rules/factors/re-auth — discarded at parse, never fetched). So M10 compares **WHICH policy applies, never policy strength**. True strength ordinals need rule capture → deferred to M11.
- **Peer set = the apps granted to the same group** (same audience — the weakest gate among them is that audience's effective exposure). `MIN_PEERS = 3`; dominant = **unique** mode covering **≥ 2/3** of peers (integer-safe `3*mode >= 2*peers`); tie ⇒ no dominant.
- **Severity:** org-default while dominant is custom ⇒ `weaker-than-peers` (weight 2, echoes rank-risk's binary). Custom-A vs dominant custom-B ⇒ `differs-from-peers` (weight 1 — relative strength unknown, say so). **Custom among org-default peers is NEVER flagged** (crown-jewel asymmetry, documented in the module header).
- **Aggregation:** one row per app; `score = Σ severityWeight × dominantCount`; evidence capped at `EVIDENCE_CAP = 8` findings (hub apps sit in hundreds of peer sets — scale rail), `findingCount` carries the truth; deterministic sort.
- **App-auth layer only.** The session-policy dual (groups reaching an app without a session policy) is deferred.
- Report object (rows + `groupsEvaluated`/`groupsWithDominant` stats), not a bare array — empty states must explain *why* ("evaluated 0 peer groups" ≠ "all conforming").

### Phase A — pure analysis ✅
- [x] `src/analysis/policy-outliers.ts` — `findPolicyOutliers(graph): OutlierReport`, O(N+E), rank-risk conventions (Set-deduped grants, dangling-protects guard, first-protects-wins pinned).
- [x] `test/synthetic.ts` extended **additively** (`authPolicies`, `protectsShare`, defaults 0 ⇒ existing counts untouched).
- [x] `test/policy-outliers.test.ts` — 11 oracle cases on inline graphs (thresholds, tie, asymmetry, cap, dedupe, dangling) + fixture negative oracle (`groupsEvaluated === 0`) + synthetic-scale invariants (<1s, cap holds, sorted, deterministic).

### Phase B — CLI ✅
- [x] `outliers` command (clones `risk` shape: `--source`/`--state`/`--json`; thresholds stay pinned constants).
- [x] `renderOutliers` — evidence lines ("in Engineering (4 apps): 3/4 peers behind Strict-Auth"), stats footer, honesty footnote (WHICH policy, not contents); JSON = full report. +4 render tests (163 total).

### Phase C — viewer ✅
- [x] `OutliersView` (one component, small AND large tenants — a table is scale-independent) + `OutlierDetailPanel` (evidence aside, "View app in graph") + `App.tsx` wiring (`showOutliers`, reset in `applyEnvelope`, header button with count, branch after `userTrace`).
- [x] Outliers recomputed **in-browser** from the graph — no envelope change (the Explorer-`rankRisk` pattern).
- [x] Verified live (Playwright): 15k-node synthetic → 1944 outliers ranked, evidence panel, → focus view; fixture → honest empty state. `web:typecheck`/`web:build` clean.

### Phase D — ground truth + wrap (in progress)
- [x] `outliers --source okta` (pre-seed-change): honest empty state matches console (Engineering's 2-app peer set < MIN_PEERS).
- [x] `seed/main.tf`: third Engineering app **Wiki** behind Strict-Auth → peer set {GitHub, Datadog, Wiki}, 2/3 Strict-Auth dominant ⇒ **GitHub = genuine weaker-than-peers outlier**.
- [ ] User applies the seed (needs write token, see seed header); then `outliers --source okta` must flag GitHub — match against the admin console.
- [ ] README section; PR; merge to `main`.

### Phase E — stretch heatmap ✅
- [x] `outlier-matrix.ts` (pure): Group×Policy matrix, **bounded** ≤8 columns (top-6 policies + Other + Org default), top-30 rows + `hiddenRowCount`, cell app-sample capped at 50. Shares `buildPeerIndex`/`dominantPolicy`/`policyCounts` with the analysis (extracted from `findPolicyOutliers`, behavior unchanged) so the dominant cell + severity never disagree with the table. +5 tests.
- [x] `OutlierMatrix.tsx`: Table|Matrix toggle in `OutliersView`; heat = policy share, dominant cell outlined, weaker/differs tinted; cell click → `CohortList` drill-in (verbatim reuse). Verified live (Playwright): 8 columns, 30 rows, dominant/weaker/differs cells correct on the 15k-node synthetic org; drill-in lists a cell's apps. 168 tests total; `web:typecheck`/`web:build` clean.

## Deferred (do NOT build in M10) → later

- **Policy rule capture + strength ordinals** (M11 candidate): parse `okta_app_signon_policy_rule`, live `GET /policies/{id}/rules`, factor-based strength bands — upgrades "differs" to a real weaker/stronger verdict.
- **Session-policy dual** — groups reaching an app without a session policy (same divergence machinery, other layer).
- Threshold CLI flags (`--min-peers` etc.) — constants until someone needs them.
- What-if / plan-diff (backlog #5); OEL evaluation; any WRITE to Okta. Read-only, local, full stop.

## Backlog — "The opinionated layer" (post-M10)

1. ~~User-level trace~~ → M7. 2. ~~Risk-ranked landing~~ → M8. 3. ~~Blast-radius~~ → M8. 4. ~~Policy outliers (divergence)~~ → M10.
5. **Policy strength** (M11 candidate) — rule capture → strength ordinals → true weaker-than-peers.
6. **What-if** — plan-diff and persona/birthright simulation — still deferred as brittle (needs OEL).

Rails if picked up: read-only always; users per-lookup, never bulk-drawn; logic pure in `src/core`/`src/analysis`, tested against fixtures.
