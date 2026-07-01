# okta-iac-lens

Local-first tool that reads Terraform-managed Okta config, visualizes access paths,
and (later) measures how much of the org is under IaC.

See [`CLAUDE.md`](CLAUDE.md) for durable design context and [`PLAN.md`](PLAN.md) for the
current milestone.

## Status: Milestone 1 — static access-path trace

From a `terraform show -json` state export, build the Okta graph and answer
"what does group X grant, and under which policies?" using pure ID matching.
No live API, no Terraform execution, no Expression Language evaluation.

## Commands

```sh
npm install                 # install deps
npm test                    # run vitest once
npm run test:watch          # vitest in watch mode
npm run build               # tsc -> dist/
npm run dev -- <args>       # run the CLI without building (tsx src/cli.ts)

# once M1 is wired:
npm run dev -- summary --state fixtures/sample-tenant.tfstate.json
npm run dev -- trace --group "Engineering" --state fixtures/sample-tenant.tfstate.json
```

## Safety

State files contain secrets and PII. `.gitignore` excludes `*.tfstate` /
`*.tfstate.json` (the fake-data fixture is the sole, explicit exception). Live API
work uses read-only scopes against the free Integrator tenant only — never production.
