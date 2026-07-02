# Seed config for the Integrator tenant — recreates the logical fixture so the live
# reader has something real to read, and doubles as the real `terraform show -json`
# export deferred from M1.
#
# NOTE: this WRITES to the tenant, so it needs a WRITE-capable token — NOT the
# read-only token the tool uses. Run it with your super-admin token in the env:
#
#   cd seed
#   export OKTA_API_TOKEN=<super-admin write token>   # do NOT put this in the repo .env
#   terraform init && terraform apply
#   terraform show -json > ../fixtures/real-tenant.tfstate.json   # gitignored
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
  org_name = "integrator-1546176" # your subdomain (the part before .okta.com)
  base_url = "okta.com"
  # api_token is read from the OKTA_API_TOKEN env var automatically.
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

# --- Group rule: department == "Engineering" populates Engineering -----------
resource "okta_group_rule" "eng_rule" {
  name              = "eng-rule"
  status            = "ACTIVE"
  expression_type   = "urn:okta:expression:1.0"
  expression_value  = "user.department==\"Engineering\""
  group_assignments = [okta_group.engineering.id]
}

# --- Global session policy applied to Engineering ----------------------------
resource "okta_policy_signon" "default_mfa" {
  name            = "Default-MFA"
  status          = "ACTIVE"
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
