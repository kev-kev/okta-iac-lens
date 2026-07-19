# Seed config for the Integrator tenant — recreates the logical fixture so the live
# reader has something real to read, and doubles as the real `terraform show -json`
# export deferred from M1.
#
# NOTE: this WRITES to the tenant, so it needs a WRITE-capable token — NOT the
# read-only token the tool uses. All connection settings come from the environment
# (nothing tenant-specific is committed); run it like:
#
#   cd seed
#   export OKTA_ORG_NAME=<your subdomain>            # e.g. integrator-123456
#   export OKTA_BASE_URL=okta.com
#   export OKTA_API_TOKEN=<super-admin write token>  # do NOT put this in the repo .env
#   terraform init && terraform apply
#   terraform show -json > ../fixtures/real-tenant.tfstate.json   # gitignored
#
# M11 post-apply step (the M14 drift probe): in the admin console, assign ONE extra
# group to the Confluence app (managed by the plural `okta_app_group_assignments`
# below). Do this AFTER the export above, or re-export once more — we want a state
# that has silently absorbed the click-ops group. See construct (4) at the bottom.
#
# M15 post-apply step: the app sign-on policy RULES (constructs 5a-5c) ride in the
# `terraform show -json` export above (they're managed resources), AND are captured live
# from GET /policies/{id}/rules by `npm run smoke` -> generated/okta-captures/. Re-run
# BOTH after apply, then `npx tsx scripts/sanitize-captures.ts` to refresh fixtures/api-real/.
#
# Untested from my side (no terraform in my sandbox) — pinned to provider v4; if an
# argument name drifts, the registry docs for your installed version win.

terraform {
  required_providers {
    okta = {
      source  = "okta/okta"
      version = "~> 4.0"
    }
  }
}

provider "okta" {
  # org_name, base_url, and api_token are all sourced from the environment
  # (OKTA_ORG_NAME / OKTA_BASE_URL / OKTA_API_TOKEN — confirmed against provider v4.20.0
  # docs). Nothing tenant-specific is hardcoded here. See the header for the exports.
}

# --- Groups ------------------------------------------------------------------
resource "okta_group" "engineering" {
  name        = "Engineering"
  description = "Engineering staff"
}

resource "okta_group" "contractors" {
  name        = "Contractors"
  description = "External contractors"
}

# --- App auth policy (must exist before the app references it) ---------------
resource "okta_app_signon_policy" "strict_auth" {
  name        = "Strict-Auth"
  description = "Stricter auth for Datadog"
}

# --- Apps --------------------------------------------------------------------
resource "okta_app_oauth" "github" {
  label          = "GitHub"
  type           = "web"
  grant_types    = ["authorization_code"]
  redirect_uris  = ["https://example.com/callback"]
  response_types = ["code"]
  # No authentication_policy set => GitHub falls back to the org default (the
  # `protects`-edge-absent case we want to exercise on the live path).
}

resource "okta_app_oauth" "datadog" {
  label          = "Datadog"
  type           = "web"
  grant_types    = ["authorization_code"]
  redirect_uris  = ["https://example.com/callback"]
  response_types = ["code"]
  # Datadog IS protected by the custom app auth policy => a `protects` edge.
  authentication_policy = okta_app_signon_policy.strict_auth.id
}

# M10 ground truth: the other Engineering apps (Datadog, Wiki, and Confluence in
# construct (4) below) all sit behind Strict-Auth, so the peer set
# {GitHub, Datadog, Wiki, Confluence} is 3/4 Strict-Auth-dominant — GitHub (org
# default) is a genuine default-while-peers-custom outlier, verifiable in the admin console.
# (Confluence MUST keep its Strict-Auth policy or the peer set ties 2-2 and the
# outlier vanishes — see the note on construct (4).)
resource "okta_app_oauth" "wiki" {
  label          = "Wiki"
  type           = "web"
  grant_types    = ["authorization_code"]
  redirect_uris  = ["https://example.com/callback"]
  response_types = ["code"]
  authentication_policy = okta_app_signon_policy.strict_auth.id
}

# --- App-to-group assignments ------------------------------------------------
resource "okta_app_group_assignment" "gh_eng" {
  app_id   = okta_app_oauth.github.id
  group_id = okta_group.engineering.id
}

resource "okta_app_group_assignment" "dd_eng" {
  app_id   = okta_app_oauth.datadog.id
  group_id = okta_group.engineering.id
}

resource "okta_app_group_assignment" "gh_con" {
  app_id   = okta_app_oauth.github.id
  group_id = okta_group.contractors.id
}

resource "okta_app_group_assignment" "wiki_eng" {
  app_id   = okta_app_oauth.wiki.id
  group_id = okta_group.engineering.id
}

# --- Group rule: department == "Engineering" populates Engineering -----------
resource "okta_group_rule" "eng_rule" {
  name              = "eng-rule"
  status            = "ACTIVE"
  expression_type   = "urn:okta:expression:1.0"
  expression_value  = "user.department==\"Engineering\""
  group_assignments = [okta_group.engineering.id]
}

# --- Global session policy applied to Engineering ----------------------------
# priority = 2 (explicit) so the M11 priority-divergence case below is deterministic.
# Address order sorts `default_mfa` BEFORE `stricter_session`, so the tool's
# first-edge-wins heuristic picks THIS policy — but Okta evaluates by priority, where
# `stricter_session` (priority 1) wins. That gap is the M11 Phase D red / M12 fix.
resource "okta_policy_signon" "default_mfa" {
  name            = "Default-MFA"
  status          = "ACTIVE"
  priority        = 2
  description     = "MFA at sign-in for Engineering"
  groups_included = [okta_group.engineering.id]
}

# --- Test user for the ground-truth acceptance test --------------------------
# department = "Engineering" so the group rule sweeps them into Engineering,
# which also exercises the rule end-to-end.
resource "okta_user" "test_user" {
  first_name = "Test"
  last_name  = "User"
  login      = "test.user@example.com"
  email      = "test.user@example.com"
  department = "Engineering"
}

# =============================================================================
# M11 adversarial additions — each construct exists to make a review-predicted
# blind spot REPRODUCE against the live tenant + the sanitized fixtures, so it
# can be pinned as an expected-red test (Phase D) that M12–M14 later green.
# The human applies these (write token); nothing here is tool-facing.
# =============================================================================

# (1) Individual user→app assignment — the unmodeled access channel (M12/M13).
# Salesforce is granted to NO group the test user belongs to; the ONLY way the
# user reaches it is this direct `okta_app_user`. `GET /users/{id}/appLinks` will
# list Salesforce (direct + indirect assignments), but the group-union trace will
# miss it. Red: user trace omits Salesforce.
resource "okta_app_oauth" "salesforce" {
  label          = "Salesforce"
  type           = "web"
  grant_types    = ["authorization_code"]
  redirect_uris  = ["https://example.com/callback"]
  response_types = ["code"]
  # deliberately NO okta_app_group_assignment — reachable only individually.
}

resource "okta_app_user" "salesforce_test_user" {
  app_id   = okta_app_oauth.salesforce.id
  user_id  = okta_user.test_user.id
  username = okta_user.test_user.email
}

# (2) Second global session policy including Engineering at a HIGHER priority
# (priority 1 wins over default_mfa's 2). Okta's effective session policy for an
# Engineering user is THIS one; the tool's first-edge-wins (address order) picks
# `default_mfa`. Red: wrong/ambiguous effective session policy under priority.
resource "okta_policy_signon" "stricter_session" {
  name            = "Stricter-Session"
  status          = "ACTIVE"
  priority        = 1
  description     = "Higher-priority session policy for Engineering"
  groups_included = [okta_group.engineering.id]
}

# (3) An INACTIVE group rule. Okta does not evaluate it, so it populates NOTHING;
# the parser ignores `status` and will draw a `populates` edge as if it were live.
# Red: INACTIVE rule treated as active (phantom populates edge).
resource "okta_group_rule" "inactive_contractor_rule" {
  name              = "inactive-contractor-rule"
  status            = "INACTIVE"
  expression_type   = "urn:okta:expression:1.0"
  expression_value  = "user.title==\"Contractor\""
  group_assignments = [okta_group.contractors.id]
}

# (4) An app managed via the PLURAL `okta_app_group_assignments` (single resource,
# `group` blocks — the non-looping pattern from the CLAUDE.md provider gotcha).
# The plural resource reads ALL groups assigned to the app from the API, so after
# apply the human adds ONE click-ops group to Confluence in the admin console; the
# next `terraform show -json` STATE absorbs that drift → coverage reports 100%
# managed with no diff. Red (M14 drift probe): plural drift absorbed as "managed".
resource "okta_app_oauth" "confluence" {
  label          = "Confluence"
  type           = "web"
  grant_types    = ["authorization_code"]
  redirect_uris  = ["https://example.com/callback"]
  response_types = ["code"]
  # Behind Strict-Auth (like Datadog/Wiki) so Confluence's presence in Engineering
  # does NOT dilute the peer set: Engineering stays 3/4 Strict-Auth-dominant and
  # GitHub (org default) remains the M10 default-while-peers-custom outlier. Without this,
  # Confluence at org-default ties Engineering 2-2 and the outlier disappears.
  authentication_policy = okta_app_signon_policy.strict_auth.id
}

resource "okta_app_group_assignments" "confluence_groups" {
  app_id = okta_app_oauth.confluence.id
  group {
    id = okta_group.engineering.id
  }
  # After apply: add a second group to Confluence via the CONSOLE (not here) — the
  # M14 drift probe. Do NOT add it as a second `group` block.
}

# =============================================================================
# M15 additions — app sign-on policy RULES, so policy STRENGTH can be derived
# from real rule CONTENTS (factors / DENY / re-auth), not just "which policy
# applies." Every rule below attaches to the EXISTING Strict-Auth policy, so it
# does NOT change which policy protects which app — the M10 outlier ground truth
# (GitHub org-default vs Strict-Auth peers) is untouched. What they DO add:
#   1. real strength SPREAD to classify (single-factor, 2FA, phishing-resistant 2FA, DENY);
#   2. the honest kicker — Strict-Auth *looks* strict, but the 1FA bypass rule (5b)
#      drops its effective floor to `single-factor` under the weakest-ALLOW-floor band
#      model (PLAN.md M15 decision). Surfacing that is the whole point of M15.
#
# Provider note (okta/okta v4.20.0): `constraints` is a List of String — each element
# is a jsonencode()'d authenticator-class object. Rule precedence is by `priority`
# (lower = evaluated first); the system catch-all rule Okta auto-creates always sorts
# last and is NOT managed here. Untested from my side (no terraform in my sandbox); if
# an argument name drifts, the registry docs for your installed version win.
#
# Priority order below: DENY off-network (1) -> 1FA contractor bypass (2) ->
# phishing-resistant 2FA for everyone else (3) -> [Okta system catch-all].
# =============================================================================

# (5a) STRONG rule — phishing-resistant 2FA. The broad ALLOW that most users hit.
# Demonstrates the `phishing-resistant-2fa` band end-to-end (possession with
# phishingResistant/hardwareProtection REQUIRED).
resource "okta_app_signon_policy_rule" "strict_pr2fa" {
  policy_id                   = okta_app_signon_policy.strict_auth.id
  name                        = "Require-Phishing-Resistant"
  access                      = "ALLOW"
  status                      = "ACTIVE"
  priority                    = 3
  type                        = "ASSURANCE"
  factor_mode                 = "2FA"
  re_authentication_frequency = "PT12H"
  constraints = [
    jsonencode({
      possession = {
        deviceBound        = "REQUIRED"
        hardwareProtection = "REQUIRED"
        phishingResistant  = "REQUIRED"
      }
    })
  ]
}

# (5b) WEAK rule — single-factor (password-only) bypass scoped to Contractors. This is
# the deliberately WEAK rule the strength model must catch: it makes an ACTIVE ALLOW rule
# that grants access with only 1FA, so the weakest-ALLOW-floor model reports Strict-Auth's
# effective floor as `single-factor` — even though the policy is named "Strict." Scoped to
# a group (no external zone id needed) and set ABOVE the PR-2FA rule so a contractor really
# is evaluated against it (console-verifiable for the human acceptance check).
resource "okta_app_signon_policy_rule" "strict_1fa_bypass" {
  policy_id                   = okta_app_signon_policy.strict_auth.id
  name                        = "Contractors-Password-Bypass"
  access                      = "ALLOW"
  status                      = "ACTIVE"
  priority                    = 2
  type                        = "ASSURANCE"
  factor_mode                 = "1FA"
  re_authentication_frequency = "PT0S"
  groups_included             = [okta_group.contractors.id]
  constraints = [
    jsonencode({
      knowledge = { types = ["password"] }
    })
  ]
}

# (5c) DENY rule — blocks off-network sign-in outright. Demonstrates access=DENY capture.
# Under the floor model a DENY rule RESTRICTS but does not set the policy's ALLOW floor
# (it grants no one), so the band model records it as evidence without letting it lower or
# raise the floor. `network_connection = OFF_NETWORK` needs no external zone id.
resource "okta_app_signon_policy_rule" "strict_deny_offnetwork" {
  policy_id          = okta_app_signon_policy.strict_auth.id
  name               = "Block-Off-Network"
  access             = "DENY"
  status             = "ACTIVE"
  priority           = 1
  network_connection = "OFF_NETWORK"
}
