# PLAN.md — current milestone

Read alongside `CLAUDE.md` (durable context). This file is the current, disposable work plan. When Milestone 1 ships, rewrite this for M2.

## Milestone 1: static access-path trace (no live environment)

**Goal:** from a `terraform show -json` file, build the Okta graph and answer "what does group X grant, and under which policies?" Pure ID-matching only. No live API, no Expression Language evaluation.

### Steps (pause at the checkpoint)

1. Scaffold the TypeScript project: package.json (ESM, scripts from CLAUDE.md), tsconfig (NodeNext), vitest, commander, tsx. Add `.gitignore` and `.env.example` per the safety rails before anything else.
2. Define `src/core/model.ts`: the node types (`Group`, `App`, `GroupRule`, `GlobalSessionPolicy`, `AppAuthPolicy`) and edge types (`populates`, `grants`, `appliesTo`, `protects`) from CLAUDE.md. Keep the two policy layers separate.
3. Write `fixtures/sample-tenant.tfstate.json` (a hand-crafted minimal export; exact contents specified in the oracle below).

--- CHECKPOINT ---
Stop here. Show me `model.ts` and the fixture before writing any parsing or traversal code. This is the one place the domain semantics must be verified by a human before downstream code calcifies them. Do not proceed past this line until I confirm.
--- END CHECKPOINT ---

4. `src/core/parse-tfstate.ts`: walk `values.root_module.resources`, recursing into `child_modules`. Extract each relevant resource's `address`, `type`, `values.id`, `values.name`, and reference fields (assignment `app_id` + group ids, group-rule target group, policy assignments). Output normalized resource records.
5. `src/core/build-graph.ts`: instantiate nodes and wire edges by matching IDs.
6. `src/core/access-paths.ts`: `trace(groupNameOrId) -> { apps: App[], globalSessionPolicy: GlobalSessionPolicy | null, appAuthPolicies: Record<appId, AppAuthPolicy | null> }`.
7. `src/inputs/tfstate-file.ts` + `src/cli.ts`: wire `summary` and `trace` commands.
8. Write vitest tests for parse, build, and trace against the fixture. Then run the real command and show me its actual stdout (not a description of it).

### Test oracle (defines "correct" for the fixture)

Build `fixtures/sample-tenant.tfstate.json` to contain exactly:

- Groups: `Engineering` (id `g-eng`), `Contractors` (id `g-con`)
- Apps: `GitHub` (id `a-gh`), `Datadog` (id `a-dd`)
- App-group assignments: `g-eng -> a-gh`, `g-eng -> a-dd`, `g-con -> a-gh`
- Group rule `eng-rule`: populates `g-eng` (expression references department == "Engineering"; stored as a literal string, NOT evaluated in M1)
- Global session policy `Default-MFA` (id `p-sess`): appliesTo `g-eng`
- App auth policy `Strict-Auth` (id `p-auth`): protects `a-dd`

Expected results:

- `trace("Engineering")` -> apps = [GitHub, Datadog]; globalSessionPolicy = `Default-MFA`; appAuthPolicies = { a-gh: null, a-dd: `Strict-Auth` }
- `trace("Contractors")` -> apps = [GitHub]; globalSessionPolicy = null; appAuthPolicies = { a-gh: null }
- `summary` -> 2 groups, 2 apps, 1 group rule, 1 global session policy, 1 app auth policy

A test passes only when output matches the above. If the real provider's `terraform show -json` shape differs from the hand-crafted fixture, fix the fixture to match reality (see deferred item on real export).

### Done when

`npm run dev -- trace --group "Engineering" --state fixtures/sample-tenant.tfstate.json` prints the expected Engineering result above, and all vitest tests pass.

## Deferred (do NOT build in M1)

- Replace/validate the hand-crafted fixture with a REAL `terraform show -json` export from the Integrator tenant. Do this as the very first task of M2 (or end of M1 if time allows) so the parser is proven against real provider output, not an invented shape.
- Live Okta API read (M2).
- Coverage reconciliation + import-block generation (M3).
- Okta Expression Language evaluation for hypothetical-user traces (later; flagged brittle).
- Web visualization (after the CLI proves the model).
- Plan-diff view (`terraform plan -json`; new-resource IDs are null pre-apply, needs the config `references` block).
