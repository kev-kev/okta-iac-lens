# okta-iac-lens

> Working name, rename freely (see note on the `okta-` prefix at the bottom). A local-first tool that reads Terraform-managed Okta config (and later the live tenant), visualizes access paths, and measures how much of the org is under IaC.

This file is durable context: it stays true across every session and milestone. Session-specific, step-by-step work lives in `PLAN.md`, not here.

## What this is

Okta admins manage their org with Terraform but can't easily see, from the code alone, **who can reach what and how**. Generic Terraform visualizers draw resource dependency graphs but don't understand Okta access semantics. This tool encodes those semantics.

Two differentiated capabilities (neither solved by existing tools like Terraformer or `terraform plan -generate-config-out`, which only dump raw HCL):

1. **Access-path visualization** — turn the resource graph into "this group grants these apps under this policy."
2. **IaC coverage / reconciliation** (later) — read the live tenant read-only, diff it against Terraform state, report the gap with pre-generated import blocks.

## Stack and conventions

- **Language:** TypeScript on Node 20 LTS or later.
- **Modules:** ESM. `"type": "module"` in package.json; `"module": "NodeNext"` in tsconfig.
- **CLI:** commander.
- **Tests:** vitest.
- **Dev runs:** `tsx` (run TS directly, no build step needed to iterate).
- **Later (M2, live API):** `@okta/okta-sdk-nodejs`, read-only scopes only.
- **Later (web viz):** Vite + a graph lib (d3 or React Flow).
- Before adding any dependency, check its current version and that it's actively maintained.

## Commands

```
npm install                 # install deps
npm test                    # run vitest once
npm run test:watch          # vitest in watch mode
npm run build               # tsc -> dist/
npm run dev -- <args>       # tsx src/cli.ts <args>  (iterate without building)

# example once M1 is wired:
npm run dev -- summary --state fixtures/sample-tenant.tfstate.json
npm run dev -- trace --group "Engineering" --state fixtures/sample-tenant.tfstate.json
```

(Define these scripts in package.json during scaffolding.)

## Architecture principle

`src/core/` is **pure**: input is Terraform JSON, output is a normalized graph model. No file I/O, no network inside core. All I/O lives in `src/inputs/` and `src/render/`. This keeps the valuable logic trivially testable against fixtures with zero environment.

## Repo structure

```
.
├── CLAUDE.md               # this file (durable context)
├── PLAN.md                 # current milestone steps + checkpoint + test oracle
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules, dist, .env, *.tfstate, *.tfstate.json exports, generated/
├── .env.example            # placeholder keys only, never real values
├── fixtures/
│   └── sample-tenant.tfstate.json
├── src/
│   ├── core/               # PURE. no I/O, no network.
│   │   ├── model.ts        # node + edge types
│   │   ├── parse-tfstate.ts# terraform show -json -> normalized resources
│   │   ├── build-graph.ts  # normalized resources -> graph
│   │   └── access-paths.ts # traversal: group -> apps + applied policies
│   ├── inputs/
│   │   ├── tfstate-file.ts # read a json file from disk
│   │   └── okta-api.ts     # (M2) live read-only tenant reader
│   ├── analysis/
│   │   └── coverage.ts     # (M3) reconcile live vs state -> gap + import blocks
│   ├── render/
│   │   ├── cli.ts          # text / JSON output
│   │   └── web/            # (later) browser graph viz
│   └── cli.ts              # commander entrypoint
└── test/
```

## Graph model

Nodes: `Group`, `App`, `GroupRule`, `GlobalSessionPolicy`, `AppAuthPolicy`, plus their rules where relevant.

Edges:
- `GroupRule --populates--> Group`  (from `okta_group_rule`)
- `Group --grants--> App`  (from app-group assignment resources)
- `GlobalSessionPolicy --appliesTo--> Group`
- `AppAuthPolicy --protects--> App`

### Important: there are TWO policy layers, not one. Do not conflate them.

Okta evaluates access through two separate policy mechanisms, and the model must keep them distinct:

1. **Global session policy** (historically called the Okta sign-on policy): governs the user's session into Okta itself (e.g. MFA at sign-in, session lifetime). It is assigned to **groups**.
2. **App authentication policy** (app-level sign-on policy): governs access to a **specific application**. It is attached to **apps**.

A user's real access to an app is gated by both layers. Collapsing them into a single "policy gates thing" edge bakes in a real misconception. Keep `GlobalSessionPolicy` and `AppAuthPolicy` as separate node/edge types.

### Resource names: confirm against your pinned provider version

The Okta provider has reshuffled resource names across major versions, so **verify the exact strings in the Terraform Registry docs for the provider version this project pins**, rather than trusting any list (including this one). As a starting reference, recent versions use roughly:

- Groups: `okta_group`
- Group rules: `okta_group_rule`
- Apps: `okta_app_oauth`, `okta_app_saml`, `okta_app_bookmark`, other `okta_app_*`
- App-to-group assignment: `okta_app_group_assignment` (single) and `okta_app_group_assignments` (plural, multiple group blocks)
- Global session policy + rules: `okta_policy_signon`, `okta_policy_rule_signon`
- App auth policy + rules: `okta_app_signon_policy`, `okta_app_signon_policy_rule`

Pin the provider version explicitly and treat the registry docs for that version as the source of truth for attribute names and reference shapes.

### Known provider gotcha (encode as a parser note, not a feature)

`okta_app_group_assignments` (plural) reads ALL groups assigned to an app from the API, not just those in config. Using `for_each` over it for the same `app_id` causes a non-converging plan loop; the correct pattern is a single resource with dynamic `group` blocks. This matters for how assignments appear in state when parsing.

## Validation strategy

Unit tests against fixtures prove the parser and graph logic. The **real** acceptance test is ground truth: for a test user in a free Okta Integrator tenant, confirm the tool's computed app access matches what the Okta admin console actually shows for that user. Match = the model is right. Divergence = a bug or a misunderstood semantic.

## Safety rails (set up before first commit)

- `.gitignore` must exclude `.env`, `*.tfstate`, and any real `*-tenant.tfstate.json` exports. State contains secrets and PII.
- `.env.example` holds placeholder keys only.
- All Okta API work (M2+) is **read-only**, against the **free Integrator tenant**, never production. Enforced at the credential, not just in code: the SSWS API token is minted by a **Read-Only Administrator** user (SSWS tokens can't be scope-limited — they inherit their creator's permissions; the OAuth scopes `okta.groups.read`/`okta.apps.read`/`okta.policies.read` apply only if we later switch to an OAuth service app). Verify with `npm run smoke -- --verify-readonly`: the write probe must get a 403.
- Credentials live in env vars only. Never hardcode, never commit.

## Scope discipline

Build only what the current `PLAN.md` milestone defines. Do not jump ahead to live API, coverage, an Okta Expression Language interpreter, or web viz until a milestone calls for them. If a decision isn't covered by `PLAN.md` or this file, ask rather than guess.

## Naming note

If this ever becomes a distributed or commercial product, reconsider the `okta-` prefix: using Okta's mark in a product name can raise trademark and brand-guideline issues. Fine for a personal repo and portfolio.
