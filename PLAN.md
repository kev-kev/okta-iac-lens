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
- **Envelope:** with-coverage round-trip preserves graph AND report; a coverage-less v1 file parses exactly as today (no overlay, no crash) — the compat row; a malformed `coverage` field is rejected with an actionable message.
- **coverage-badges:** gap injection → `bucketByNodeId` marks exactly `g-ops`/`a-slack` unmanaged and fixtures managed; `bucketByEdgeId` marks exactly `grants:a-gh… (g-ops)` unmanaged; noise injection → Everyone/system-policy ids excluded.
- **CLI:** `--viz` file's `graph` deep-equals the graph built from the live-side resources; text output contains "Recommended steps"; JSON parses with `recommendations`.

### Phase A done when

- Contracts pinned + checkpoint passed; `recommendations.ts`, CLI wiring, `coverage-badges`, and the viewer UI exist; every oracle row passes; `npm test` + `npm run web:build` green; no live call made; zero new dependencies confirmed.

## Phase B — live ground truth + demo (live reads run on Opus per the standing session note)

- [ ] `coverage --state generated/seed-state.json --viz generated/coverage-graph.json` (read-only) → load in viewer: baseline shows all cards managed, built-ins muted-excluded, coverage 100%, recommendations = confirmation only.
- [ ] **Recreate the M3 click-ops experiment, visually:** create the test group + GitHub assignment in the console → re-export → overlay shows exactly one unmanaged card + one unmanaged grants edge, panel says 10/12 with the "bring 2 under IaC" recommendation → delete → back to 100%. (The M3 acceptance test, now in pixels.)
- [ ] Screenshot the gap state → README (coverage section).
- [ ] Light security pass: no new deps or input types this milestone, so the branch-diff `/security-review` suffices (vs M4's full audit). Confirm the enriched envelope stays gitignored (`generated/`).
- [ ] Record quirks here; then PR.

## Deferred (do NOT build in M5)

- Ghost cards for stale resources; any canvas presence for non-live resources.
- Plan-diff view — now cheaper (it's "the next overlay"), but still its own milestone.
- Attribute-level drift; OEL evaluation (unchanged reasons).
- npm packaging / hosted demo polish.
- Any WRITE operation against Okta. Read-only, full stop.
