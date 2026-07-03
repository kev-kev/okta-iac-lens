# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 4 ships, rewrite this for M5.

> **Status of M1 (shipped):** `terraform show -json` -> `ParsedResource[]` -> `OktaGraph` -> `trace()`/`summary`, tested against `fixtures/sample-tenant.tfstate.json`.
>
> **Status of M2 (shipped):** live read-only reader emits the same `ParsedResource[]`; API-vs-tfstate graph equivalence proven offline; ground-truth acceptance vs the admin console passed on the seeded Integrator tenant. Read-only rail verified live (write probe 403s).
>
> **Status of M3 (shipped):** `coverage` command reconciles live tenant vs state over the shared `ParsedResource[]` seam (presence-first classification), generates import blocks confirmed against okta/okta v4.20.0. Ground truth passed live: baseline 10/10 = 100%; a click-ops gap surfaced as exactly 2 unmanaged; generated blocks proved out with `terraform plan: 2 to import, 0 to change`; restore returned to 100%.

## Milestone 4: web visualization of access paths

**Goal:** the "visualizes access paths" promise from the project's own description, in pixels. A **local-first, fully static** web viewer (Vite + React Flow, in `src/render/web/`) that loads a graph exported by a new `export` CLI command and renders the access graph with the **two policy layers visually distinct**; clicking a group highlights its full trace (apps + both policy layers), matching CLI `trace` semantics exactly. No server, no credentials near the browser, no live calls from the viewer — it opens a JSON file.

**The load-bearing design decision:** the viewer imports the SAME pure core the CLI uses. `src/core/` is pure ESM with zero Node-only imports, so `trace()`/`summarize()` run in the browser via Vite unchanged; the interchange format is the serialized `OktaGraph` (already plain arrays by design — model.ts built it to be snapshotted). **No traversal logic is reimplemented in UI code.** If the viewer needs a computation core doesn't provide, add it as a pure function and test it against fixtures — never fork semantics into a component. A viewer-side "parallel trace" is the M2 design smell wearing a new hat; stop and reconsider.

**Scope rails:**

- **Trace interaction only.** No coverage overlay (M5 candidate), no plan-diff, no editing, no animation beyond select/highlight/dim.
- **Static viewer.** File open / drag-drop only. A `serve` command, live-tenant mode in the browser, or any URL-fetching in the viewer: out.
- **Read-only against Okta, as always.** The only live touch in M4 is `export --source okta` (existing M2 reader), and only in Phase B.
- **Fixture-scale layout.** A hand-rolled layered layout (pure function, no dependency) is sufficient for tens of nodes. Auto-layout libraries (dagre/elk) are deferred until a real tenant makes the simple layout unusable.

### The two policy layers, now in pixels (do not undo the model's core rule)

The viewer must make `GlobalSessionPolicy` and `AppAuthPolicy` **visually unmistakable as different things**: distinct node styling AND distinct edge styling for `appliesTo` vs `protects`, and a legend that names them ("Global session policy — gates sign-in to Okta" / "App auth policy — gates a specific app"). The absence semantic carries over too: an app with no `protects` edge renders as **"org default app policy"**, never as unprotected/bare (model.ts rule, verified live in M2/M3).

### Interchange format (pin at checkpoint)

`export` writes a versioned envelope, so the viewer can reject foreign/stale files with a clear message:

```json
{ "version": 1, "source": "tfstate" | "okta", "generatedAt": "<ISO8601>", "graph": { "nodes": [...], "edges": [...] } }
```

The `graph` value is the untransformed `OktaGraph`. Edges carry no ids in the model; the viewer derives React Flow ids as `${kind}:${from}:${to}` (the same composite the M2 equivalence test sorts on).

## Phase A — fixture-driven (no live data, no credentials; pause at the checkpoint)

1. **Dependency evaluation (CLAUDE.md rule: check before adding).** Record here: current versions, last release, maintenance state for `@xyflow/react` (React Flow's current package name — verify; the `reactflow` package was superseded), `react`/`react-dom`, `vite`, `@vitejs/plugin-react`. Confirm React Flow's license (MIT expected) and that the pure-core-in-browser assumption holds (no Node built-ins anywhere under `src/core/` — grep it). Decide single-package layout: root `package.json` gains devDeps + `web`/`web:build` scripts with Vite rooted at `src/render/web/`; a separate web `tsconfig` adds `DOM` lib + JSX. No workspaces unless something forces them.

--- CHECKPOINT: review the dependency writeup + the pinned envelope schema before scaffolding. ---

2. **`export` CLI command.** Same input options as `summary`/`trace` (`--source tfstate|okta`, `--state <path>`), plus `-o <path>` (default `generated/graph.json` — gitignored territory). Writes the envelope above. Reuses `loadGraph`; no new I/O paths. Missing-creds and missing-state errors behave exactly like the existing commands.
3. **Viewer pure modules first (testable with zero DOM):**
   - `parse-envelope.ts` — validate version/shape, actionable errors ("not an okta-iac-lens export", "unsupported version").
   - `layout.ts` — layered columns by kind: GroupRule | Group | App, session policies flanking groups, app policies flanking apps; pure `(graph) -> Map<nodeId, {x,y}>`; deterministic.
   - `highlight.ts` — `(graph, traceResult) -> { nodeIds, edgeIds }`: the selected group, its granted apps, its session policy, each app's auth policy, and exactly the `grants`/`appliesTo`/`protects` edges between them. Built ON `trace()` output, not re-derived from raw edges.
4. **Scaffold + render.** Vite app in `src/render/web/`: file-open + drag-drop -> parse-envelope -> React Flow canvas. Custom node component per `NodeKind` (5), distinct edge styles per `EdgeKind` (4), the policy-layer legend, node labels = `name`. `npm run web` serves it; `npm run web:build` must produce a static bundle.
5. **Trace interaction.** Click a Group -> run `trace()` (the imported core function) -> highlight set lights up, everything else dims; a detail panel lists what the CLI prints: granted apps with per-app policy or "org default app policy", plus the session policy or "(none)". Click elsewhere clears. Non-Group nodes: select/inspect only, no trace.
6. **Tests + build green.** vitest for the three pure modules against the fixture graph; the export-command snapshot test; then `npm test` AND `npm run web:build` — show actual output of both.

### Test oracle for Phase A (fixture tenant, same as M1–M3)

- **Export:** `export --state fixtures/sample-tenant.tfstate.json` -> envelope with `version: 1`, `source: "tfstate"`, and `graph` deep-equal to `buildGraph(parseTfState(fixture))`. Parsing that file back through `parse-envelope` returns an identical graph (round-trip).
- **parse-envelope:** rejects `{version: 2}`, missing `graph`, and non-envelope JSON, each with a distinct actionable message.
- **layout:** every node gets exactly one position; all Groups share the group column, Apps the app column; no two nodes at identical coordinates; output is deterministic across runs.
- **highlight for `Engineering`:** nodes = exactly {g-eng, a-gh, a-dd, p-sess, p-auth}; edges = exactly {grants:g-eng:a-gh, grants:g-eng:a-dd, appliesTo:p-sess:g-eng, protects:p-auth:a-dd}. Note a-gh contributes NO protects edge — org default.
- **highlight for `Contractors`:** nodes = exactly {g-con, a-gh}; edges = exactly {grants:g-con:a-gh}. No policy nodes — Contractors has no session policy and GitHub is org-default.
- **Build:** `web:build` exits 0 and emits a static bundle.

### Phase A done when

- Dependency writeup recorded here and checkpoint passed; `export` + the three pure modules + the viewer exist; every oracle row passes; `npm test` and `npm run web:build` both green; viewer verified by hand against `generated/graph.json` from the M1 fixture; no live call made, no credential touched.

## Phase B — ground truth + demo polish (small; live read runs on Opus per the session note)

- [ ] `export --source okta -o generated/live-graph.json` (read-only, Integrator tenant) and load it in the viewer.
- [ ] **Manual acceptance checklist (mirrors M2's ground truth):** clicking Engineering shows GitHub + Datadog; Datadog badges Strict-Auth; GitHub badges "org default app policy"; Default-MFA links to Engineering; the two policy layers are visually distinct at a glance; the Okta built-ins that appear live (Everyone, Okta Administrators, console policies are NOT in the graph — they were never graph nodes) render sensibly.
- [ ] Screenshot the Engineering trace -> `README.md` demo section.
- [ ] **CI (the distribution slice):** GitHub Actions workflow running `npm test` + `npm run web:build` on PRs to main.
- [ ] Record any browser/bundling quirks discovered (e.g. anything in core that turned out not to be browser-safe) here.

## Deferred (do NOT build in M4)

- **Coverage overlay in the viewer** (managed/unmanaged/excluded badges) — the natural M5, pulling M3's report into the same canvas.
- `serve` command / live mode in the browser; any viewer network I/O.
- Plan-diff view (`terraform plan -json`) — sequenced after viz on purpose; it lands as a before/after view in this viewer.
- Auto-layout libraries; large-tenant performance work (virtualization, clustering).
- Attribute-level drift; OEL evaluation (both still deferred, same reasons as M3).
- Any WRITE operation against Okta. Still read-only, full stop.
