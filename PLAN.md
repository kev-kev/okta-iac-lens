# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 4 ships, rewrite this for M5.

> **Status of M1 (shipped):** `terraform show -json` -> `ParsedResource[]` -> `OktaGraph` -> `trace()`/`summary`, tested against `fixtures/sample-tenant.tfstate.json`.
>
> **Status of M2 (shipped):** live read-only reader emits the same `ParsedResource[]`; API-vs-tfstate graph equivalence proven offline; ground-truth acceptance vs the admin console passed on the seeded Integrator tenant. Read-only rail verified live (write probe 403s).
>
> **Status of M3 (shipped):** `coverage` command reconciles live tenant vs state over the shared `ParsedResource[]` seam (presence-first classification), generates import blocks confirmed against okta/okta v4.20.0. Ground truth passed live: baseline 10/10 = 100%; a click-ops gap surfaced as exactly 2 unmanaged; generated blocks proved out with `terraform plan: 2 to import, 0 to change`; restore returned to 100%.

## Milestone 4: web visualization of access paths

> **Design revision (2026-07-03, mid-Phase-A, from hands-on review).** Two changes to the original plan below, made because the hand-rolled layout produced edges running through cards and the policy-node encoding was the root cause:
> 1. **Layout: adopted dagre** (`@dagrejs/dagre` 3.0.0, MIT) for layered left-to-right layout. The "auto-layout deferred" rail below is lifted — the simple layout became unusable at fixture scale (edge-through-node), which was the stated trigger. `layout.ts` is now a thin dagre wrapper.
> 2. **Policies are card ATTRIBUTES, not nodes.** `deriveCards()` (pure) splits the graph into a flow-only DAG (rule/group/app) plus policy-as-attribute maps; each group card shows its Session policy, each app card its Auth policy. This is the relational-vs-attribute-encoding call (Munzner): the flow is the relationship we analyze (edges), policies are properties (badges). Sharing is recovered on demand — clicking a policy badge highlights every resource it governs (`highlightForPolicy` + `PolicyPanel`). The two-layer distinctness and org-default rules below are UNCHANGED and still enforced (amber session badge vs red auth badge; "org default" never blank). Where the steps below say "policy nodes / distinct edge styling for appliesTo vs protects," read "distinct policy BADGES"; `appliesTo`/`protects` no longer appear as drawn edges.

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

### Dependency evaluation (step 1 writeup, recorded 2026-07-03)

**Decision: add the deps — all current, MIT, actively maintained, and compatible with this repo's Node 24 / ESM setup. No blockers; the milestone's core assumption holds.**

| package | version | license | note |
|---|---|---|---|
| `@xyflow/react` | 12.11.1 | MIT | Current pkg (superseded `reactflow`). Published ~2026-06-23 (~10 days ago) — actively maintained, patch cadence. |
| `react` / `react-dom` | 19.2.7 | MIT | React Flow peers are `react >=17`, so **React 19 is fully supported** — the compatibility risk I flagged is a non-issue. |
| `vite` | 8.1.3 | MIT | engines `^20.19 || >=22.12`; local Node is v24.14 — fine. |
| `@vitejs/plugin-react` | 6.0.3 | MIT | peer `vite ^8.0.0` — aligns exactly with Vite 8. The tight 6↔8 peer coupling is itself evidence of coordinated, current maintenance. |

- **Pure-core-in-browser assumption CONFIRMED.** Grep of `src/core/` for `node:`/`fs`/`path`/`url`/`process`/`__dirname`/`Buffer`/`require(` — zero hits; and `src/core/` imports nothing from `inputs/`/`render/`/`analysis/`. `import('./src/core/access-paths.ts')` resolves clean with all transitive deps. So `trace()`/`summarize()` run in the browser via Vite unchanged, exactly as the load-bearing decision assumes.
- **Layout decision: single package, no workspaces.** Root `package.json` gains the 5 devDeps above + `web` (Vite dev server) and `web:build` (static bundle) scripts, Vite rooted at `src/render/web/`. A second `tsconfig` (`src/render/web/tsconfig.json`) extends the root and adds `lib: ["DOM","DOM.Iterable"]` + `jsx: "react-jsx"`; the root config stays Node/`NodeNext` so vitest and the CLI are untouched. Vite resolves the repo's `.js`-extension ESM imports natively, so core imports need no change.
- **Testing-surface decision (flagged in pre-flight):** NO React component unit tests in M4 — no `jsdom`/`@testing-library/react`. The three pure viewer modules (parse-envelope, layout, highlight) are DOM-free and fully unit-tested; components are verified by `web:build` (exit 0 + bundle) plus manual acceptance (Phase B). Keeps the dep surface to the 5 above. Revisit only if component logic grows non-trivial.
- **Sources:** npm registry (`registry.npmjs.org/{@xyflow/react,react,vite,@vitejs/plugin-react}`), [xyflow releases](https://github.com/xyflow/xyflow/releases).

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

- [x] `export --source okta -o generated/live-graph.json` (read-only, Integrator tenant) — DONE. 14 nodes / 7 edges. `deriveCards` verified against the live export (data ground truth, matches the M3 console check): Engineering→Default-MFA, Everyone→Default Policy, Contractors/Okta Administrators→(none); Datadog→Strict-Auth, GitHub→org default. The 4 Okta-created console app-auth policies attach to no visible app and drop out of the viewer (the same noise M3 excluded — intended under attribute encoding).
- [ ] **Manual acceptance checklist (visual; reworded for the badge design):** load `generated/live-graph.json`; the flow lays out rule→group→app with **no edge crossing a card**; Engineering's **Session policy** badge = Default-MFA, Datadog's **Auth policy** badge = Strict-Auth, GitHub's = "org default"; the two badge layers read as distinct (amber session vs red auth); clicking **Engineering** highlights GitHub + Datadog; clicking a **policy badge** highlights every card it governs; built-in groups (Everyone, Okta Administrators) render sensibly.
- [ ] Screenshot the viewer → `docs/viewer.png` (referenced by `README.md`). *(Needs a browser — capture during the visual check above.)*
- [x] **CI (the distribution slice):** `.github/workflows/ci.yml` runs root `tsc`, `web:typecheck`, `npm test`, and `web:build` on PRs/pushes to main.
- [x] **Recorded quirks:** (1) core is browser-safe as assumed — no Node built-ins reached the bundle. (2) Under attribute encoding, a policy attached to no *visible* resource is invisible in the viewer (the 4 Okta console app policies) — intended, mirrors M3 coverage exclusion; if a real orphaned custom policy ever needs surfacing, that's a viewer feature, not a bug. Add any browser quirks found during the visual check.
- [ ] **Final M4 step — comprehensive security review (before the PR).** Run once the viewer is visually signed off: the new dependency/supply-chain surface (React/React Flow/dagre/Vite), the viewer's untrusted-JSON input path (`parseEnvelope`), browser rendering of tenant-derived strings (no `dangerouslySetInnerHTML`/`eval`; static, no network), a **git-history secret/PII scan**, and credential handling across M2/M3. Broader than the branch-diff `/security-review` skill — run it as a full-project pass.

## Backlog — "Recommended steps to increase IaC coverage" (feature request 2026-07-03)

Surfaced right next to the coverage % — in the CLI `coverage` output now, and in the M5 viewer coverage overlay later — a short, prioritized, plain-language list of what the user can do to bring more of their Okta under Terraform. (Not an M4 item; recorded here so it survives the M4→M5 plan rewrite. Scoping calls below are mine — adjust when we pick it up.)

- **Pure and derived, never hardcoded.** New pure module `src/analysis/recommendations.ts`: `recommend(report: CoverageReport): Recommendation[]`. Every suggestion is computed from the coverage buckets, so it can't drift from the actual tenant state and unit-tests against the same oracle fixtures as `coverage`. Same purity rail as the rest of `src/analysis`.
- **Content, ordered by impact:**
  - `unmanaged > 0` → the headline action: "Bring N resources under IaC," broken down by kind, with the exact path (`coverage --imports <file>` → add the generated blocks → `terraform plan` to import). Prioritize kinds by count / lowest per-kind coverage.
  - `stale > 0` → "N resources are in Terraform but not the tenant — remove them from config, or investigate drift."
  - `excluded` → informational: "N resources are Okta-managed (built-ins/system) and can't be Terraformed; they're excluded from the %, not a gap."
  - 100% managed → positive confirmation, plus optional next-level nudges.
- **Rendered** in the CLI coverage text/JSON, and (M5) as a panel beside the viewer's coverage overlay — the two pair naturally, so this is a strong M5 companion to that overlay.
- **Rail:** guidance only. It never mutates Okta and never writes config on its own; the human still runs `terraform`. Read-only discipline holds.

## Deferred (do NOT build in M4)

- **Coverage overlay in the viewer** (managed/unmanaged/excluded badges) — the natural M5, pulling M3's report into the same canvas; pairs with the recommended-steps panel above.
- `serve` command / live mode in the browser; any viewer network I/O.
- Plan-diff view (`terraform plan -json`) — sequenced after viz on purpose; it lands as a before/after view in this viewer.
- Auto-layout libraries; large-tenant performance work (virtualization, clustering).
- Attribute-level drift; OEL evaluation (both still deferred, same reasons as M3).
- Any WRITE operation against Okta. Still read-only, full stop.
