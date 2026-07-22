/**
 * web/strength-notes: the ONE place the outlier surfaces (table, detail panel, heatmap) phrase
 * their strength caveat, so they can't drift from each other or make a stale claim (M15 Phase D,
 * the Phase E honesty rule). Pure, DOM-free.
 *
 * Three regimes, mirroring the CLI's `renderOutliers`:
 *  - `prior`       — no strength resolver (a pre-M15 export, or a rule-less tenant): the M13 prior
 *                    stands VERBATIM (this is the surface Phase E's grep must still find the caveat on).
 *  - `grounded`    — rules captured and ≥1 shown divergence has both bands known: the divergence
 *                    verdicts read policy CONTENTS, so the "not a factor-based verdict" claim would
 *                    now be a lie — replaced with the honest grounded wording + scope caveat.
 *  - `all-unknown` — rules captured but every shown divergence has an unknown band (e.g. an
 *                    org-default app whose system-policy rules aren't in this export): no grounded
 *                    verdict is possible, so it stays a prior.
 */

export type VerdictRegime = "prior" | "grounded" | "all-unknown";

/** Pick the regime from whether a resolver exists and whether any shown divergence is grounded. */
export function verdictRegime(hasResolver: boolean, anyGrounded: boolean): VerdictRegime {
  if (!hasResolver) return "prior";
  return anyGrounded ? "grounded" : "all-unknown";
}

/** The honest caveat sentence for a regime — surface-agnostic (no reference to ↳ / table / matrix). */
export function outlierStrengthNote(regime: VerdictRegime): string {
  switch (regime) {
    case "grounded":
      return (
        "Where both a divergent app's gate and its peers' dominant policy have captured rules, the " +
        "strength verdict is grounded (M15): each side's weakest-way-in band + deciding rule. A " +
        "scoped bypass floors the policy, not necessarily every app/user. Divergences with an " +
        "unknown band (e.g. an org-default app whose rules aren't in this export) stay a prior."
      );
    case "all-unknown":
      return (
        "Every divergence shown has an unknown band (e.g. an org-default app whose system-policy " +
        "rules aren't in this export), so it stays a prior: gate strength is a heuristic prior " +
        "(org-default vs custom policy), not a proven weakness."
      );
    case "prior":
      return (
        "Gate strength is a heuristic prior (org-default vs custom policy), not a factor-based " +
        "verdict (M15). This flags a divergence, not a proven weakness."
      );
  }
}
