# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 8 ships, rewrite this for M9.

> **Shipped:** **M1** static trace. **M2** live read-only reader (graph equivalence + ground truth). **M3** `coverage` reconciliation + import blocks. **M4** static web viewer (policies as card attributes; group-trace + policy-sharing). **M5** coverage overlay + recommended steps. **M6** scale the viewer (query-first landing + cohort overview + bounded depth-1 focus + hub truncation; slim envelope; synthetic-scale invariants). **M7** user-level access trace (`trace --user`; a user is a trace INPUT, not a graph node; live ground truth; security review clean).

## Milestone 8: risk-ranked landing + blast-radius framing

**Goal:** make the viewer **opinionated**. Rank apps and groups by a composite an IT engineer cares about — **reach × gate strength × IaC status** — so "widest reach, weakest gate, not in Terraform" sorts first, replacing the Explorer's graph-order inventory. Blast-radius wording rides along on the focus view.

**Design (load-bearing):** one pure `rankRisk(graph, coverage?)` in `src/analysis/` drives BOTH the `risk` CLI and the viewer sort (zero forked logic). The ranking is **legible, not a black box** — every row exposes the raw signals (reach count, gate label, IaC bucket) beside the score. Score is multiplicative — `reach × (weak-gate?2:1) × (unmanaged?2:1)` — so "wide AND weak AND unmanaged" compounds; weights pinned at the Phase-A checkpoint. Coverage is **optional** (it's a two-input live-vs-state reconciliation); absent ⇒ `iac: "unknown"` and the IaC weight neutralizes.

**Signals (all reuse existing pure code):** REACH from `groupsGrantingApp`/`appsGrantedByGroup` (now exported, `access-paths.ts`). GATE from `authPolicyForApp`/`sessionPolicyForGroup` (null ⇒ weak). IaC from `computeCoverage` items joined by `key === node.id`.

### Phase A — pure engine + CLI ✅ (shipped)
- [x] Export the four edge-walk helpers (behavior-preserving; all trace tests green).
- [x] `src/analysis/rank-risk.ts` — pure `rankRisk` + `RiskRow`; multiplicative score (checkpoint-pinned).
- [x] `risk` CLI (`--source`, or `--iac` to reconcile live vs `--state`); `renderRisk` table + `--json`.
- [x] `test/rank-risk.test.ts` — reach×gate oracle (GitHub > Datadog), IaC lifts an unmanaged Slack to #1, `iac:"unknown"` neutral without coverage, render text/JSON. 124 tests green; build clean.

### Phase B — viewer ✅ (shipped)
- [x] `Explorer.tsx` — memoized `rankRisk`; risk/name sort toggle on the App/Group tabs; row meta shows `reach · gate · iac`; weak-gate rows get a subtle cue.
- [x] `FocusDetailPanel.tsx` — blast-radius wording ("N apps and M rules depend on this group" / "Reached by N groups via M rules") from counts in hand.
- [x] `web:build` green; whole-graph + below-threshold paths unchanged.
- [ ] **(Stretch, optional)** reach × gate quadrant view — droppable; only if there's room.

### Phase C — ground truth + wrap (pending)
- [ ] Live full-signal run: `risk --iac --state <path>` against the Integrator tenant → an unmanaged/wide/weak resource tops the list; sanity-check against the console. (Opus, read-only.)
- [ ] Viewer visual check: `npm run gen:scale` → `npm run web` → App/Group tabs lead with hubs behind weak gates; a focus view reads blast-radius. Screenshot → README.
- [x] Viewer visual check passed after O(N+E) perf fix (Browse-all was ~30s at 15k nodes; now instant; scale-guard test added).
- [x] Branch `/security-review` — **clean**, no HIGH/MEDIUM findings: rankRisk is pure in-memory computation; `risk` CLI reuses existing reviewed I/O seams; renderers are text/JSX-escaped; no new PII/token/write surface. PR; merge to `main`.
- [ ] (Optional, post-merge) Live full-signal run: `risk --iac --state <path>` against the Integrator tenant.

## Deferred (do NOT build in M8) → M9 and beyond

- **Local read-only server + live GUI features** (user trace in the browser, live graph refresh) → **M9**. Browser → localhost → Okta; the SSWS token stays server-side (never in the browser; sidesteps CORS). A real architectural shift away from the "fully static, no network calls" rail — needs its own design + a security review of the localhost read endpoint. This is where the M7 "user-trace in the GUI" ask lands.
- Policy-outlier views (backlog #4); what-if / plan-diff (#5); runtime policy-condition / OEL evaluation.
- Any WRITE operation against Okta. Read-only, full stop.

## Backlog — "The opinionated layer" (post-M8)

1. ~~User-level trace~~ → M7. 2. ~~Risk-ranked landing~~ → M8. 3. ~~Blast-radius framing~~ → M8.
4. **Policy outlier views** — apps behind a weaker policy than their cohort (table/heatmap; the parked adjacency-matrix fits here).
5. **What-if** — plan-diff (next overlay) and persona/birthright simulation — still deferred as brittle (needs OEL).
Plus the **M9 local server** enabling live GUI reads (user trace, refresh).

Rails if picked up: read-only always; users per-lookup, never bulk-drawn; ranking logic pure in `src/analysis/`, tested against fixtures.
