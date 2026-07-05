# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 6 ships, rewrite this for M7.

> **Shipped:** **M1** static trace (`terraform show -json` → `ParsedResource[]` → `OktaGraph` → `trace`/`summary`). **M2** live read-only reader emitting the same `ParsedResource[]`; graph equivalence + admin-console ground truth passed. **M3** `coverage` reconciliation (presence-first classification over the shared seam) + import blocks confirmed against okta/okta v4.20.0; live click-ops ground truth passed. **M4** static web viewer (Vite + React Flow + dagre; policies as card attributes; group-trace + policy-sharing); live ground truth; CI; security review clean. **M5** coverage overlay + recommended steps (managed/unmanaged/excluded badges on cards/edges/policy-badges; pure `recommend()` in CLI + viewer; coverage rides the same envelope as an optional additive field); live click-ops ground truth in pixels; security review clean.

## Milestone 6: scale the viewer to enterprise tenants

**Goal:** the viewer stays legible and responsive at enterprise scale (target: **5k apps / 10k groups / 60k assignments**) without giving up the local-first static file. Above a size threshold the viewer becomes **query-first**: a scale-independent landing surface (search + inventory lists + coverage) where every canvas render is a **bounded focus view**. At or below the threshold (≤ ~300 nodes), the current whole-graph M4/M5 canvas renders exactly as today. (Design comparison run 2026-07-04 at max effort; decisions confirmed: A+C hybrid, include reverse trace, this scale target, auto-threshold. Durable principle in CLAUDE.md → "Scale strategy".)

**The load-bearing design decision:** change the **definition of a view**, not the renderer. No canvas render may depend on org size — every focus view is bounded by construction (visible budget ~150 nodes; hub truncation). Rejected alternatives, recorded: semantic-zoom/clustered overview (Okta data has no natural hierarchy to cluster on; converges to needing focus views at the leaves; highest cost) and renderer swaps (canvas/WebGL solves paint, not legibility). All new logic is PURE and fixture-testable: `traceApp()` (reverse trace) in core, `buildFocusView()` / search index / adjacency indexes in viewer pure modules.

**Scope rails:**

- **Local-first stays.** One static envelope file; in-memory indexes built once at load. No backend, no streaming, no chunked files in M6 (escape hatches recorded in CLAUDE.md for beyond-target scale).
- **Hub truncation is non-negotiable:** a group granting N ≫ k apps renders top-k edges + ONE aggregate pseudo-node ("…and N−k more — browse list") that opens a panel list. Same for apps with many groups. k ≈ 12, pinned at checkpoint.
- **Policy semantics unchanged:** two layers distinct, "org default" ≠ unprotected, policies stay card attributes.
- **Zero forked logic:** the viewer imports pure core/analysis; new pure functions live in core (`traceApp`) or viewer pure modules, tested against fixtures.
- The synthetic-scale data is generated IN TESTS (seeded, deterministic) — never a committed multi-MB fixture, never from a real tenant.

### Phase A — offline (pause at the checkpoint)

1. **Pin the contracts.** (a) Envelope slimming: the embedded coverage's `items[].resource` (full ParsedResource per item) exists for CLI import-block generation, which the viewer never does; `recommend()` needs only `overall`/`perKind`, panels need `kind/key/name/bucket/reason`. Decide the slimmed shape (projection type vs optional field) + compat handling (M5 "fat" envelopes must still load). (b) `traceApp()` signature (mirror of `trace()`: groups granting the app + rules populating those groups + its auth policy). (c) Budget + k values; auto-threshold value (~300). (d) Virtualized list: tiny dep (version-check per CLAUDE.md) vs hand-rolled.

--- CHECKPOINT: review slimmed-envelope shape, traceApp contract, and budget/threshold constants before building. ---

2. **Core:** pure `traceApp(graph, appNameOrId)` + reverse adjacency; CLI surface `trace --app <nameOrId>` (cheap, same renderer shape).
3. **Viewer pure modules:** `indexes.ts` (id→node, group→apps, app→groups, name-search index — built once per load); `build-focus-view.ts` (foci + budget → bounded flow graph with aggregate pseudo-nodes; eviction by distance-from-focus, unmanaged-ness boosts retention).
4. **Landing surface (the C half):** above-threshold files land on search + per-kind virtualized inventory tabs (filter by coverage bucket/name) + the existing CoveragePanel. Below-threshold: today's full canvas, unchanged.
5. **Focus canvas (the A half):** search/row-click → focus view rendered through the existing GraphView (cards, badges, overlay, dagre — all reused); click neighbor = re-focus; shift-click = add neighborhood under budget; aggregate pseudo-node click = panel list.
6. **Tests + build green — show output.**

### Test oracle for Phase A

- **Synthetic-scale generator** (pure, seeded): 5k apps / 10k groups / 60k assignments / heavy-tail hubs (incl. one group→800 apps, one app→400 groups).
- **buildFocusView:** NEVER exceeds budget for any focus in the synthetic org (property-style row); hub focus yields exactly k edges + 1 aggregate node reporting N−k; unmanaged neighbors survive eviction over managed ones at equal distance.
- **traceApp:** on the fixture tenant, `traceApp("GitHub")` → groups {Engineering, Contractors}, rule eng-rule (via Engineering), auth policy null/org-default; `traceApp("Datadog")` → {Engineering}, Strict-Auth. Mirrors the M1 trace oracle.
- **indexes:** build over the synthetic org completes within a generous smoke bound; lookups match brute-force scans on sampled ids.
- **Threshold:** fixture envelope (≤300 nodes) → full-canvas mode; synthetic envelope → query-first mode. Slimmed-envelope compat: M5 fat envelopes still load (compat row), slim envelopes drive panels + recommend() identically.
- **web:build** green; whole-graph path regression-covered by existing M4/M5 tests.

### Phase A done when

- Contracts pinned + checkpoint passed; `traceApp` + CLI flag, `indexes`, `build-focus-view`, the landing surface, and the focus canvas exist; every oracle row passes; `npm test` + `npm run web:build` green; small-tenant whole-graph path unchanged; no live call made.

### Phase B — ground truth + demo

- [ ] Script writes a synthetic-scale envelope to `generated/` (gitignored); load in browser: responsive search, bounded focus views, visible hub truncation, inventory tabs smooth. (No live data involved.)
- [ ] Live regression: the real Integrator tenant (small) still lands on the full canvas exactly as M5 shipped it. (Live read — Opus per the standing note.)
- [ ] Screenshot a focus view at scale → README.
- [ ] Branch `/security-review`; PR.

## Deferred (do NOT build in M6)

- Semantic-zoom/clustered overview; adjacency-matrix density mode (recorded alternatives — revisit only if org-shape-at-a-glance becomes a demanded task).
- Chunked envelopes / SQLite-wasm (beyond-target scale escape hatches); any backend.
- Click-ops attribution via System Log (`okta.logs.read` — separate backlog item, M7 candidate).
- Plan-diff view; attribute-level drift; OEL evaluation.
- Any WRITE operation against Okta. Read-only, full stop.

## Backlog — "The opinionated layer: what an enterprise IT engineer actually needs" (recorded 2026-07-05, M7 scoping input)

From the mid-M6 product conversation. The honest principle: at enterprise scale, engineers don't browse graphs — they arrive with a question (a ticket, an audit, a change, a posture review). A node-link canvas earns its keep for exactly two jobs — **path explanation** ("why does X reach Y", the trace/focus views) and **blast radius** ("what depends on this thing I'm changing") — and everything else that matters is **ranked lists, tables, quadrants, and diffs that link INTO the canvas**. M6's query-first substrate is the right skeleton; what it lacks is opinionation (the Explorer sorts alphabetically; an engineer needs risk/reach order). Candidate features, ranked by value:

1. **User-level trace (the headline; requires REOPENING the users-out-of-scope decision).** "Why does/doesn't user U reach app A" is the single most common enterprise question. Not a cardinality problem — you look up ONE user at a time: their group memberships (read-only `okta.users.read` + per-user groups API), which memberships came via which rule vs. direct assignment, then the existing group→app→policy machinery. Scales fine; needs a new read-only scope + model surface (User as a trace INPUT, not bulk graph nodes).
2. **Risk-ranked landing page** (cheap — all data in hand): cross **reach** (groups-granting-an-app / apps-granted-by-a-group, computable from edges today) × **gate strength** (org-default vs. custom auth policy) × **IaC status** (unmanaged). "Widest reach, weakest gate, not in Terraform" sorts first; scatter/quadrant view + ranked inventory replacing alphabetical sort.
3. **Blast-radius framing of the focus view** (near-free): same computation, ticket-ready words — "42 apps and 3 rules depend on this group."
4. **Policy outlier views** — apps that look like their cohort but sit behind a weaker policy (table/heatmap; the parked adjacency-matrix fits here).
5. **What-if**: plan-diff (deferred, still the next overlay) and persona/birthright simulation ("what does a new dept=X hire get?") — the real ask behind OEL evaluation, still deferred as brittle.

Rails if picked up: read-only always; users are per-lookup trace inputs, never bulk-fetched or drawn in bulk; ranking logic pure in `src/analysis/`, tested against fixtures like everything else.
