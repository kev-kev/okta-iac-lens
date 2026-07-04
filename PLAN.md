# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 5 ships, rewrite this for M6.

> **Shipped:** **M1** static trace (`terraform show -json` → `ParsedResource[]` → `OktaGraph` → `trace`/`summary`). **M2** live read-only reader emitting the same `ParsedResource[]`; graph equivalence + admin-console ground truth passed. **M3** `coverage` reconciliation (presence-first classification over the shared seam) + import blocks confirmed against okta/okta v4.20.0; live click-ops ground truth passed (`plan: 2 to import, 0 to change`). **M4** static web viewer (Vite + React Flow + dagre; policies as card attributes; group-trace + policy-sharing interactions); live ground truth passed; CI; pre-PR security review clean.

## Milestone 5: coverage overlay + recommended steps

**Goal:** fuse the project's two differentiated capabilities into one surface. The M4 viewer learns what the M3 engine knows: every card badges as **managed / not in Terraform / Okta-managed**, unmanaged assignments show on their edges, a coverage panel gives the % and itemizes gaps — and a new **recommended-steps** list (pure, derived from the report) tells the user exactly how to raise their IaC coverage, in both the CLI `coverage` output and the viewer panel.

**The load-bearing design decision:** coverage reaches the viewer through the SAME envelope, as an **optional additive `coverage` field** — no version bump (absent field = no overlay; unknown fields were never rejected), no second file, no viewer network I/O, no creds near the browser. It's written by the `coverage` command itself (new `--viz <path>` flag) because that command already holds both inputs; the embedded `graph` is built from the live resources already fetched — **zero extra API calls**. Recommendations are never serialized: a pure `recommend(report)` is the single source of truth, called by the CLI renderer and the viewer alike. If the viewer needs coverage logic the analysis layer doesn't export, add it as a pure function — never fork classification semantics into UI code (the standing rule).

**Scope rails:**

- **Zero new dependencies.** Everything builds on `computeCoverage`, the envelope, and the existing viewer. If a step seems to need a dep, stop and reconsider.
- **Stale = panel list only** (decided at scoping): stale resources get NO card — the canvas stays a truthful picture of the live tenant. Ghost cards are deferred.
- **Recommendations are guidance only** — they never mutate Okta and never write config; the human runs `terraform`. Read-only discipline holds everywhere, as always.
- **Presence-only, still.** The overlay visualizes M3's buckets; no attribute drift, no new classification logic.
- Users remain out of scope.

### Where each bucket lands in the viewer

- **Group / App / GroupRule cards** → badge by bucket: `unmanaged` prominent ("NOT IN TERRAFORM"), `managed` subtle, `excluded` muted ("Okta-managed"). Bucket lookup joins the report's `(kind, key)` items to card ids.
- **AppGroupAssignment buckets** → they're EDGES, not cards: an unmanaged `grants` edge gets distinct styling (the M3 click-ops gap was a group + an assignment — both must be visible).
- **Policy buckets** → policies are card *attributes* (M4), so coverage marks the policy **badge** itself, preserving the M4 encoding. The two layers stay visually distinct, and "org default" semantics are untouched.
- **Stale** → coverage panel list (kind + name), no canvas presence. **Excluded** → itemized in the panel with reasons, muted on canvas.
- Overlay is ON by default when the envelope carries `coverage`, with a toggle; loading a coverage-less export renders exactly as M4 does today (compat is an oracle row).
- Panel behavior: the coverage panel (%, per-kind rows, stale/excluded lists, recommendations) shows when nothing is selected; group-trace / policy panels take over on selection, Clear returns to coverage.

## Phase A — offline, fixture-driven (pause at the checkpoint)

1. **Pin the two contracts.** (a) Envelope: `coverage?: CoverageReport` — confirm `CoverageReport` is plain JSON-serializable data end-to-end (it is by construction; verify round-trip). `parse-envelope` validates the field's shape when present, tolerates absence. (b) Command surface: `coverage --viz <path>` (embedded graph = live side). Sanity-check that `recommend()` and any new viewer helpers can stay browser-safe (no Node imports).

--- CHECKPOINT: confirm envelope shape + command surface before building. ---

2. **`src/analysis/recommendations.ts`** — pure `recommend(report: CoverageReport): Recommendation[]`, priority-ordered per the backlog spec this milestone consumes: `unmanaged > 0` → headline "bring N under IaC" with per-kind counts and the exact path (`coverage --imports <file>` → add blocks → `terraform plan`); `stale > 0` → remove-from-config-or-investigate; `excluded` → informational (not a gap); 100% → positive confirmation. Each item: `{severity, title, detail}`.
3. **CLI wiring.** `coverage` text output appends a "Recommended steps" section; `--json` gains a `recommendations` field (additive). New `--viz <path>` writes the enriched envelope.
4. **Viewer pure modules first:** extend `parse-envelope` (optional field validation); new `coverage-badges.ts` — `(report) → {bucketByNodeId, bucketByEdgeId(grants), bucketByPolicyId}` maps the components consume.
5. **Viewer UI:** card + policy-badge bucket styling, unmanaged-`grants` edge styling, overlay toggle, `CoveragePanel` (%, per-kind, stale + excluded lists, recommendations via the imported `recommend()`).
6. **Tests + build green — show output.** Oracle below; `npm test` and `npm run web:build`.

### Test oracle for Phase A (same fixture tenant; reuse the M3 in-test injections)

- **recommend():** baseline (100%) → exactly one confirmation item; gap injection (Click-Ops group + Slack + assignment) → headline "3 unmanaged" with per-kind breakdown mentioning `--imports`; stale injection → a stale-guidance item; noise injection → informational-only, no action items.
- **Envelope:** with-coverage round-trip preserves graph AND report; a coverage-less v1 file parses exactly as today (no overlay, no crash) — the compat row; a malformed `coverage` field **degrades gracefully** (decision B) — graph still renders, overlay dropped, `notice` set — rather than rejecting the file.
- **coverage-badges:** gap injection → `bucketByNodeId` marks exactly `g-ops`/`a-slack` unmanaged and fixtures managed; `bucketByEdgeId` marks exactly `grants:a-gh… (g-ops)` unmanaged; noise injection → Everyone/system-policy ids excluded.
- **CLI:** `--viz` file's `graph` deep-equals the graph built from the live-side resources; text output contains "Recommended steps"; JSON parses with `recommendations`.

### Phase A done when

- Contracts pinned + checkpoint passed; `recommendations.ts`, CLI wiring, `coverage-badges`, and the viewer UI exist; every oracle row passes; `npm test` + `npm run web:build` green; no live call made; zero new dependencies confirmed.

## Phase B — live ground truth + demo (live reads run on Opus per the standing session note)

- [x] `coverage --state generated/seed-state.json --viz generated/coverage-graph.json` (read-only) → loaded in viewer: baseline all-managed, built-ins muted-excluded, 100%, recommendations = info + confirmation. Envelope badge data verified (5 managed cards, 2 excluded groups, 3 managed edges, policies bucketed correctly). User confirmed the overlay visually.
- [x] **Click-ops experiment (gap half):** group + GitHub assignment created in console → re-export showed exactly 1 unmanaged card + 1 unmanaged grants edge, 10/12 = 83.3%, "Bring 2 resources under IaC" recommendation, correct import blocks. User confirmed visually.
- [ ] **Restore:** delete the Click-Ops Test group in the console → re-export → back to 100%.
- [ ] Screenshot the gap state → `docs/coverage.png` + README coverage section.
- [ ] Light security pass: no new deps or input types this milestone, so the branch-diff `/security-review` suffices (vs M4's full audit). Confirm the enriched envelope stays gitignored (`generated/`).
- [ ] Record quirks here; then PR.

## Deferred (do NOT build in M5)

- Ghost cards for stale resources; any canvas presence for non-live resources.
- Plan-diff view — now cheaper (it's "the next overlay"), but still its own milestone.
- Attribute-level drift; OEL evaluation (unchanged reasons).
- npm packaging / hosted demo polish.
- Any WRITE operation against Okta. Read-only, full stop.

---

# Milestone 6 (QUEUED — starts after M5 ships): scale the viewer to enterprise tenants

> Scoped 2026-07-04 (design comparison run at max effort; decisions confirmed: A+C hybrid, include reverse trace, target 5k apps / 10k groups / 60k assignments, auto-threshold keeps the full canvas for small tenants). When M5 merges, promote this section to the top of a rewritten PLAN.md. The durable principle lives in CLAUDE.md ("Scale strategy").

**Goal:** the viewer stays legible and responsive at enterprise scale (target: **5k apps / 10k groups / 60k assignments**) without giving up the local-first static file. Above a size threshold the viewer becomes **query-first**: a scale-independent landing surface (search + inventory lists + coverage) where every canvas render is a **bounded focus view**. At or below the threshold (≤ ~300 nodes), the current whole-graph M4/M5 canvas renders exactly as today.

**The load-bearing design decision:** change the **definition of a view**, not the renderer. No canvas render may depend on org size — every focus view is bounded by construction (visible budget ~150 nodes; hub truncation). Rejected alternatives, recorded: semantic-zoom/clustered overview (Okta data has no natural hierarchy to cluster on; converges to needing focus views at the leaves; highest cost) and renderer swaps (canvas/WebGL solves paint, not legibility). All new logic is PURE and fixture-testable: `traceApp()` (reverse trace) in core, `buildFocusView()` / search index / adjacency indexes in viewer pure modules.

**Scope rails:**

- **Local-first stays.** One static envelope file; in-memory indexes built once at load. No backend, no streaming, no chunked files in M6 (escape hatches recorded in CLAUDE.md for beyond-target scale).
- **Hub truncation is non-negotiable:** a group granting N ≫ k apps renders top-k edges + ONE aggregate pseudo-node ("…and N−k more — browse list") that opens a panel list. Same for apps with many groups. k ≈ 12, pinned at checkpoint.
- **Policy semantics unchanged:** two layers distinct, "org default" ≠ unprotected, policies stay card attributes.
- The synthetic-scale data is generated IN TESTS (seeded, deterministic) — never a committed multi-MB fixture, never from a real tenant.

### Phase A — offline (pause at the checkpoint)

1. **Pin the contracts.** (a) Envelope slimming: the embedded coverage's `items[].resource` (full ParsedResource per item) exists for CLI import-block generation, which the viewer never does; `recommend()` needs only `overall`/`perKind`, panels need `kind/key/name/bucket/reason`. Decide the slimmed shape (projection type vs optional field) + compat handling. (b) `traceApp()` signature (mirror of `trace()`: groups granting the app + rules populating those groups + its auth policy). (c) Budget + k values; auto-threshold value (~300). (d) Virtualized list: tiny dep (version-check per CLAUDE.md) vs hand-rolled.

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

### Phase B — ground truth + demo

- [ ] Script writes a synthetic-scale envelope to `generated/` (gitignored); load in browser: responsive search, bounded focus views, visible hub truncation, inventory tabs smooth. (No live data involved.)
- [ ] Live regression: the real Integrator tenant (small) still lands on the full canvas exactly as M5 shipped it. (Live read — Opus per the standing note.)
- [ ] Screenshot a focus view at scale → README.
- [ ] Branch `/security-review`; PR.

### Deferred (do NOT build in M6)

- Semantic-zoom/clustered overview; adjacency-matrix density mode (recorded alternatives).
- Chunked envelopes / SQLite-wasm (beyond-target scale escape hatches); any backend.
- Click-ops attribution via System Log (`okta.logs.read` — separate backlog item, M7 candidate).
- Plan-diff view; attribute drift; OEL; write operations (never).
