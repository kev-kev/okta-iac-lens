# okta-iac-lens — Project Summary

A self-contained overview of the project — readable with zero prior context.

## What it does (plain terms)

**okta-iac-lens** is a local-first developer tool for teams that manage their Okta org with
Terraform. It reads Okta configuration — either from a Terraform state export or directly from
the live Okta tenant (read-only) — and does two things: (1) **visualizes access paths** ("this
group grants these apps, gated by these policies"), and (2) **measures IaC coverage** — how much
of the live org is actually under Terraform, exactly what isn't, and it generates ready-to-apply
Terraform `import` blocks to close the gap. It runs as a CLI and as a static local web viewer.

## The problem it solves

Okta admins manage their org as code with Terraform, but two real pains have no good tool:

- **You can't see access from the config.** Okta's admin GUI shows you one group or one app at a
  time; it doesn't show "who can reach what, and under which policies" as a picture. And generic
  Terraform visualizers (or `terraform graph`) draw a *resource dependency* graph — they don't
  understand Okta access semantics, so the picture is meaningless for answering "what does this
  group actually grant?"
- **You can't see IaC drift/coverage.** People create groups and app assignments by hand in the
  console ("click-ops"). Nothing tells you how much of your org escaped Terraform, or gives you a
  clean path to bring it back under management. Existing tools (Terraformer,
  `terraform plan -generate-config-out`) only dump raw HCL — they don't measure the gap or reason
  about access.

The differentiated bet: encode **Okta's actual access semantics** (two distinct policy layers,
group→app grants, group-rule membership) rather than a generic resource graph.

## Tech stack & architecture

**Language/runtime:** TypeScript on Node 20+, pure ESM (`"type": "module"`, `NodeNext`).

**How it ingests data (important nuance):**
- **Terraform state, not raw HCL.** It parses the JSON produced by `terraform show -json` (state
  with resolved concrete IDs), not `.tf` source. This means Terraform does the variable/reference
  resolution and the tool gets real Okta IDs to join on — no HCL parser needed.
- **Live Okta REST API.** A read-only reader hits the Okta API directly via a ~150-line **thin
  typed `fetch` client** (SSWS token auth, RFC-5988 `Link`-header pagination). Deliberately *not*
  the official `@okta/okta-sdk-nodejs` SDK — that SDK drags in legacy `node-fetch` and an OAuth
  crypto stack we don't use for six read-only GETs.
- **The load-bearing seam:** both inputs normalize to the *same* tagged-union type,
  `ParsedResource[]`. Everything downstream (graph building, traversal, coverage) is written once
  and works identically whichever source the data came from.

**Graph / visualization layer:**
- Core graph model: nodes (`Group`, `App`, `GroupRule`, `GlobalSessionPolicy`, `AppAuthPolicy`)
  and typed edges (`populates`, `grants`, `appliesTo`, `protects`).
- Web viewer: **Vite + React 19 + React Flow (`@xyflow/react`)** with **dagre** for layered
  graph layout. It's a **fully static** app — no server, no backend. You export a graph to a JSON
  file from the CLI and open it in the viewer; the viewer makes zero network calls.

**How it's run:**
- **CLI** (commander): `summary`, `trace`, `coverage`, `export` commands. Run via `tsx` in dev.
- **Static web viewer**: `npm run web` (dev) / `npm run web:build` (static bundle).
- **Local-first throughout** — no hosted service, no database.

**Architecture principle:** `src/core/` and `src/analysis/` are **pure** — no file I/O, no
network, zero Node-only imports. All I/O lives in `src/inputs/` (tfstate file reader, live API
reader) and `src/render/` (CLI output, web viewer). Because the core is pure ESM, the **exact
same `trace()` / coverage code runs in the browser** via Vite — the viewer imports the core
directly instead of reimplementing traversal in UI code. This purity is what makes the valuable
logic trivially testable against fixtures with zero environment.

## What works today vs. what's planned

**Working today (shipped, ~102 passing tests):**
- **Static trace** from a Terraform state export: "what does group X grant, under which policies?"
- **Live read-only tenant reader** producing an identical graph to the state path (proven by a
  graph-equivalence test, and ground-truthed against the Okta admin console).
- **IaC coverage / reconciliation**: classify every resource as managed / unmanaged (in Okta but
  not Terraform) / stale (in Terraform but not Okta) / excluded (Okta-managed built-ins);
  coverage % per kind; and **generated Terraform `import` blocks** for the gap (verified to
  produce a clean `terraform plan` showing exactly the expected imports).
- **Web viewer** with the two policy layers shown as card attributes, click-to-trace, and a
  **coverage overlay** (badges resources managed/unmanaged/excluded + prioritized "recommended
  steps" to raise coverage).
- **Enterprise-scale viewer (in progress on a branch):** a query-first UX — an **aggregated
  cohort overview** as the landing (thousands of nodes collapse to a handful of cohort cards with
  count-weighted ribbons) and **depth-1 "ego" focus views** with truncation ("+N more") so no
  single render depends on org size.

**Planned / deliberately deferred:**
- **User-level trace** ("why can/can't user U reach app A?") — the highest-value next feature;
  requires modeling users as a per-lookup input (not bulk).
- **Attribute-level drift** (coverage is presence-only today).
- **Terraform plan-diff view** ("what will this change do to access?").
- **Okta Expression Language evaluation** (group-rule expressions are stored literally, not
  interpreted).

## Interesting technical decisions & tradeoffs

1. **One normalized seam (`ParsedResource[]`) between "where data comes from" and "what we
   compute."** Adding the live-API input required *zero* changes to the graph/traversal code — it
   just had to emit the same normalized records. This is the decision I'm most happy with; it's
   why the codebase stayed small as capabilities grew.
2. **Pure core that runs in both Node and the browser.** No traversal logic is forked into React
   components; the viewer calls the same `trace()` the CLI does. Kept correctness in one place.
3. **Two policy layers kept distinct.** Okta gates access with *two* separate mechanisms — a
   **global session policy** (attached to groups, gates sign-in to Okta) and an **app auth
   policy** (attached to apps, gates one app). Collapsing them into one "policy" edge would bake
   in a real misconception, so the model keeps them separate — and "no app policy" renders as
   **"org default," never "unprotected."** This is the semantic generic tools miss.
4. **Parse state-JSON, not HCL.** Resolved IDs for free, no HCL parser, Terraform does the work.
   Tradeoff: needs a state export and doesn't reason about pre-apply config drift (that's the
   deferred plan-diff feature).
5. **Presence-only coverage (not attribute drift).** The differentiated value is "what's not in
   Terraform at all"; attribute drift largely overlaps `terraform plan -refresh-only`. Avoided a
   wide, brittle per-attribute mapping.
6. **Scale = "fix the view definition, not the renderer."** No canvas render may depend on org
   size. Rejected semantic-zoom *hierarchy* clustering (Okta has no natural hierarchy) but
   adopted *cohort* aggregation (group by computed dimensions: connectivity band, policy,
   coverage bucket). Focus views are depth-1 ego graphs with hub truncation.
7. **Read-only safety enforced at the credential, not just in code.** The live token is minted by
   a Read-Only Administrator; a write probe returns 403. State files/live exports (secrets + PII)
   are gitignored; credentials are env-only.
8. **Held a "zero new dependencies" line where reasonable** (e.g., a hand-rolled virtualized list
   instead of pulling a library) and version-checked every dependency before adding it.

## Current state & known limitations

- **M1–M5 are complete and merged;** the enterprise-scale work (M6) is built and green on a
  branch, pending a final visual pass, a screenshot, a security review, and a PR.
- **Validation is fixtures + a seeded synthetic-scale generator + a free Okta Integrator test
  tenant.** Scale claims are property-tested invariants (e.g., "a focus view never exceeds its
  node budget"), *not* proven against a real production enterprise org.
- **Users aren't in the model yet** — so the most common real-world question ("why does user X
  have access?") isn't answerable today. Deliberate scope line, and the clear next milestone.
- **Group-rule expressions are stored literally, not evaluated** — no hypothetical-user membership.
- **The web viewer is a small-tenant/demo surface by default**; the enterprise UX (overview +
  focus) is the branch work that makes it legible at scale.

## Questions a technical interviewer might push on (and honest answers)

- **"Why parse state JSON instead of the HCL or the plan?"** State has resolved IDs to join on
  and lets Terraform do reference resolution; parsing HCL would mean reimplementing variable
  resolution. The cost is that it can't reason about config *before* apply — which is exactly the
  plan-diff feature scoped as future work.
- **"Users aren't modeled — isn't 'who can access what' the whole point?"** Group-level access is
  the reusable structure and what you manage in Terraform; user-level is a per-lookup on top of
  it (one user's group memberships → the existing group→app→policy machinery). It's the top of the
  backlog, gated on adding one read-only scope. Scoped out early on purpose to keep the core model
  tight; the path to add it is clear.
- **"How do you know it's correct?"** Two layers: unit tests against hand-authored fixtures prove
  the parser/graph/coverage logic, and the *real* acceptance test is ground truth — for a test
  user in a live tenant, the tool's computed access and applied policies matched what the Okta
  admin console shows, on every check. The coverage feature was validated end-to-end: create a
  click-ops gap → tool reports exactly it → generated import blocks produce a clean
  `terraform plan` → delete it → back to 100%.
- **"Does 'local-first, no backend' actually scale?"** For a realistic read-only snapshot, yes:
  the graph is one static file, indexes are built once in memory, and the coverage payload is
  slimmed. It never draws the whole graph — the viewer is query-first (aggregated overview +
  bounded focus views), so rendering cost is independent of org size. Escape hatches (chunked
  index files, SQLite-wasm) are noted but weren't needed; no backend is forced.
- **"You only tested against a free test tenant and synthetic data."** True. The synthetic
  generator is seeded/deterministic and models the real pain (heavy-tailed "hub" groups/apps), and
  scale behavior is encoded as tested invariants rather than hoped for — but it hasn't been run
  against a production enterprise org, which would be the bar before claiming production readiness.
- **"Coverage is presence-only — what about drift?"** Deliberate. Attribute drift overlaps
  `terraform plan -refresh-only`; the differentiated value here is presence ("what's unmanaged")
  plus the import blocks to fix it. Attribute drift is a scoped future addition, not an oversight.
- **"Why not the official Okta SDK?"** For six read-only paginated GETs, the SDK's transitive
  weight (legacy fetch + OAuth crypto) bought nothing; a ~150-line typed fetch client is smaller
  and fully sufficient. Worth revisiting only if OAuth service-app auth (DPoP/private-key JWT)
  becomes necessary.
