# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 13 ships, rewrite this for M14.

> **Shipped:** **M1** static trace. **M2** live read-only reader. **M3** `coverage` + import blocks. **M4** static web viewer. **M5** coverage overlay + recommended steps. **M6** scale (query-first landing + bounded focus). **M7** user-level access trace. **M8** risk ranking. **M9** local read-only server + visual user trace. **M10** policy outliers + Group×Policy heatmap. **M11** validation hardening (provider fact table, adversarial seed, sanitized real fixtures, expected-red suite). **M12** made the graph *true* — APP-type allowlist, priority-picked session policy, INACTIVE rules populate no one, `okta_app_user`/`okta_app_access_policy_assignment` counted+surfaced. Suite: 197 passed | 1 expected-fail (red #7 trace half, held for M13).

## Context: what's left armed

`test/expected-red.test.ts` still holds **one** open `it.fails` — red **#7's trace half** (line ~82, `"M13: user trace must include individually-assigned apps (Salesforce via okta_app_user)"`). M12 delivered #7's *count+surface* half; M13 owns the *trace inclusion* half and greens it.

The other work is not test-armed — it's an **honesty debt** the M11 review flagged: the tool prints strength verdicts ("weaker-than-peers", "weak gate", "strong") it cannot actually justify. The model carries no rule/factor/re-auth data (that's M15), so any weak/strong claim is an unproven ordering dressed as fact. M13 makes the *labels* match what the tool actually knows.

## Milestone 13: make the claims honest

**Goal:** every surface says only what the graph proves. Strength verdicts become direction-neutral, documented **priors** ("org-default *while* peers are custom" — a divergence, not a proven weakness). And the per-user trace stops under-reporting: it folds in apps a user reaches by **individual assignment**, greening red #7.

**Rails (unchanged):** core (`src/core`, `src/analysis`) stays pure — no I/O, no network. All tool reads read-only. **A user is never a graph node** — individual assignments enter `traceUser` as a per-lookup *input* (one user at a time), never as graph edges and never via a bulk `/apps/{id}/users` sweep (the PII rail). No envelope bump: all changes are pure-analysis relabels + an additive optional `traceUser` param; the viewer reads neither the renamed labels' old spelling nor a new graph field. `ENVELOPE_VERSION` stays 1.

### Red this milestone greens (delete the `.fails` marker when it flips)

| # | Red (from `expected-red.test.ts`) | M13 fix |
|---|---|---|
| 7 (trace half) | user trace must include individually-assigned Salesforce | `traceUser` gains `directApps` (apps reaching the user *not* via any group); folded into the app union + surfaced as "via individual assignment". The red test is updated to pass `directApps` derived from `realStateResources()` filtered to the test user (see Phase C). |

The other M13 work adds **new positive tests**, not red flips.

---

### Workstream 1 — Relabel strength claims direction-neutral (Phase A; independent, pull-forward-able)

The renames are pure-analysis + render. Nothing about the *scoring math* changes — the multipliers stay (they encode a defensible prior); only the **words and type names** stop overclaiming, and every surface gains a one-line caveat.

**`src/analysis/policy-outliers.ts`:**
- `OutlierSeverity`: `"weaker-than-peers"` → **`"default-while-peers-custom"`**. `"differs-from-peers"` stays (already neutral).
- Constant `WEAKER_MULT` → **`DEFAULT_VS_CUSTOM_MULT`** (value stays 2). Doc it as: *org-default is more-often-than-not the looser gate — a scoring prior, not a proven ordering. M15's factor bands replace the prior with evidence.*
- Update the `severity ===` comparisons and the `entry.severity` assignment (lines ~193/205/206) to the new literal.

**`src/analysis/rank-risk.ts`:**
- `gateStrength: "weak" | "strong"` → **`gatePrior: "default" | "custom"`** on `RiskRow`. (App: custom-policy→`custom`, else `default`. Group: has-session→`custom`, else `default`. The `session-policy`/`none`/`org-default`/`custom` `GateLabel` stays — it's already factual.)
- `WEAK_GATE_MULT` → **`DEFAULT_GATE_MULT`** (value stays 2), same "prior, not proof" doc.
- `score()` signature + call sites take `gatePrior`.

**Render surfaces — relabel + add the caveat line** (grep first; these are the known hits):
- `src/render/cli.ts` — `risk` and `outliers` text/JSON output. Replace "weak"/"weaker-than-peers" wording; add a footer caveat: *"Gate strength is a heuristic prior (org-default vs custom policy), not a factor-based verdict — M15. This flags a divergence, not a proven weakness."*
- `src/render/web/OutlierMatrix.tsx`, `OutlierDetailPanel.tsx`, `OutliersView.tsx`, `outlier-matrix.ts` — severity labels/legend/tooltips; add the same caveat as a panel footnote/tooltip.
- `src/render/web/styles.css` — any `weaker`/`weak` CSS class names (rename for consistency; keep the visual treatment).

**Coverage:** update `outliers`/`rank-risk` unit tests to the new literals; add one assertion per surface that the caveat string is present (so the honesty note can't silently regress).

### Workstream 2 — User trace: fold in individual assignments (greens red #7 trace half)

**Pure core (`src/core/access-paths.ts`):**
- `traceUser(graph, membership, opts?)` gains **`opts.directApps?: AppNode[]`** — apps this user reaches that are *not* granted by any of their groups (individual/direct provisioning). Default `[]` → today's behavior, so the 197 existing tests stay green.
- Fold `directApps` into the deduped `apps` union (still name-sorted). Add **`individualApps: AppNode[]`** to `UserTraceResult` = the subset that came *only* via direct assignment (in `directApps`, not group-reached). Populate `appAuthPolicies` for them too (they're real apps with real gates).
- Provenance stays honest: `viaGroups` is unchanged (individual apps have no granting group); `individualApps` is the separate, labeled channel. Doc that a user is still never a node — `directApps` is a per-lookup input.

**I/O layer — two resolvers converge on the one pure param:**
- **Live (`trace --user` production):** the *appLinks diff*. New read-only reader method `listUserAppLinks(userId): Promise<{appInstanceId, label}[]>` → `GET /api/v1/users/{userId}/appLinks` (verify the exact scope — `okta.users.read` is the working assumption; confirm against the pinned provider/API docs and that it's a plain GET, so `smoke --verify-readonly` is unaffected). **appLinks is per-link, not per-app** — an app can expose multiple links; dedupe by `appInstanceId`. `directApps` = appLinks apps **minus** group-reached apps, matched to graph `AppNode`s by `appInstanceId`. This catches click-ops individual grants too, not just Terraform ones — the honest "what Okta actually shows this user." appLinks entries matching **no** graph `AppNode` (click-ops app not in Terraform at all) are never silently dropped: they're returned as a separate `unmatchedApps: {appInstanceId, label}[]` from the resolver and surfaced by `renderUserTrace` as *"reachable but not in Terraform (N)"* — the only pre-M14 surface that shows this drift.
- **State/static:** filter `AppUserAssignment` records (M12) by `userId` → app ids → graph `AppNode`s. Deterministic, no network. This is what the red-#7 fixture test uses.
- Both live in `src/inputs` (a helper alongside `loadUserMembership`); `traceUser` stays pure.

**Render:**
- `src/render/cli.ts` `renderUserTrace` — surface `individualApps` as a distinct block: *"+N via individual assignment (okta_app_user / appLinks — not a group grant)."* Live traces also print the resolver's `unmatchedApps` line: *"reachable but not in Terraform (N): <labels>"*.
- Viewer (optional, trimmable Phase D): the M9 visual user trace + `UserTracePanel`. Server `/api/user-membership` (`src/server/api.ts`) also returns `directApps` (live appLinks diff); `buildUserAccessGraph`/`user-access-graph.ts` render individual apps as app nodes with no group edge (a distinct "individual" visual channel). If this over-runs, ship CLI+core and defer the viewer surface to a nice-to-have — red #7 is CLI/core only.

---

### Phases

- **A — relabel (Workstream 1).** Direction-neutral types + priors in `policy-outliers.ts`/`rank-risk.ts`; caveat lines on every CLI + viewer gate/severity surface; tests updated to new literals + caveat-presence assertions. **Also README:** update "weaker" wording and regenerate any screenshot showing old severity labels (test assertions can't catch stale docs). **Independent — pull forward if anything demo-facing looms.**
- **B — pure trace core (Workstream 2).** `traceUser` gains `directApps`/`individualApps`; unit tests (empty default = unchanged; directApps folded + surfaced separately; auth policy resolved for individual apps).
- **C — resolvers + green red #7.** State resolver (filter `AppUserAssignment` by userId) + live resolver (`listUserAppLinks` + appLinks diff) in `src/inputs`. Update red #7 in `expected-red.test.ts` to pass state-derived `directApps`, confirm it goes green, **delete the `.fails` marker.** Add a fake-reader unit test for the appLinks-diff resolver (no network).
- **D — surfaces.** CLI `renderUserTrace` individual-assignment block. Viewer/server appLinks wiring (**trimmable** — see Workstream 2).
- **E — verify + lock.** Full suite green, **0 expected-fail** (red #7 flipped). `npm run build` + web typecheck clean. Live seed trace (`trace --user test.user@…`) shows Salesforce via individual assignment and still matches the console (**human check**). **Hidden-app probe (human):** assign an app to the test user with "hide from end-user dashboard" set and confirm whether appLinks returns it; if it doesn't, add a one-line blind-spot caveat to the trace output and record the finding here. Security note: appLinks is a new GET on the users scope — re-confirm read-only.

**Done when:** red #7 greens (marker removed) and the suite has 0 `it.fails` ✅; no weak/strong verdict prints without a "prior, not proof" caveat and no `"weaker-than-peers"`/`gateStrength` literal remains ✅; `traceUser` folds individual assignments via the additive `directApps` param with the user still never a graph node ✅; no envelope bump ✅; existing tests pass + new tests lock each change ✅; live `trace --user` matches the console including individually-assigned apps (human check).

**PR-body note (breaking rename):** the `risk`/`outliers` `--json` literals change (`"weaker-than-peers"` → `"default-while-peers-custom"`, `gateStrength` → `gatePrior`) even though `ENVELOPE_VERSION` stays 1 — the CLI JSON output is an interface too; date the break in the PR so future consumers can find it.

## Roadmap (rewrite this file per milestone as each starts)

- **M14 — make coverage truthful.** Built-in apps excluded (identities from the M11 captures, not hardcoded); AppAuthPolicy exclusion keyed to MANAGED/excluded referencing apps; plural-sourced assignment pairs tagged + annotated "state-tracked; absorbs drift". **Prerequisite (M11 Phase D finding, still open):** committed real state does NOT yet carry the Confluence click-ops drift — human must re-export state *after* the click-ops add + re-sanitize first, else there's no failing silent-absorption fixture (the plural resource reads ALL live groups on refresh). Until then M13's live appLinks diff is the only surface that shows individual/click-ops drift. **This is a human task with no M13 code dependency — do it any time during M13 so M14 starts unblocked.**
- **M15 — policy strength for real.** Rule capture (`okta_app_signon_policy_rule`; live `GET /policies/{id}/rules`) → factor-based strength bands → grounded weaker/stronger verdicts with evidence. This is what M13's "prior, not proof" caveats promise. Builds on M12's `status`/`priority` substrate; may finally justify an envelope bump for rule refs.

## Nice-to-haves (batch opportunistically; never a milestone)

- Viewer individual-assignment channel (if trimmed from M13 Phase D).
- appLinks reverse-anomaly: group-reached but ABSENT from a user's appLinks → surface as a discrepancy (deprovisioning lag / rule mismatch). Small add once the diff exists.
- Matrix "Other"-fold masking: soften the "never disagree with the table" doc claim; behavior fix only if >6-custom-policy tenants become real.
- `HttpOktaReader`: one 429 retry honoring `Retry-After`; `limit=200` on paginated lists.
- Small-tenant "View app in graph" for org-default outlier apps; `blastLine` rule dedupe.
- `matchSegments` Unicode length edge; `perSideCap` resize.

## Explicitly not doing (decided 2026-07-10, revisitable)

- **Bulk individual-assignment modeling** (`/apps/{id}/users` across all apps): violates the users-per-lookup PII rail. The per-user appLinks diff (M13) + `okta_app_user` presence signal (M12) cover the audit story.
- **Coverage against CONFIG (plan-JSON) instead of state:** the M14 annotation delivers most of the honesty; config parsing is a large lift for a personal tool.
- Threshold CLI flags, OEL evaluation, what-if simulation, any WRITE to Okta. Read-only, local, full stop.
