/**
 * OutlierDetailPanel — the evidence for one outlier row: which peer groups diverge and what
 * their dominant policy is ("in Engineering (11 apps): 9/11 peers behind Strict-Auth"). All data
 * comes pre-resolved on the OutlierRow — no graph joins here. "Org default" is the org-wide
 * default app sign-on policy, never "no auth".
 *
 * M15 Phase D: when a strength resolver is supplied, each divergence carries a grounded `↳` verdict
 * (subject gate vs peer-dominant policy, both bands + deciding rule) — the SAME shared helper the
 * CLI renders through. Ungrounded divergences (an unknown band) show no verdict and keep the prior.
 */
import type { OutlierRow } from "../../analysis/policy-outliers.js";
import { outlierStrengthVerdict, type StrengthResolver } from "../../analysis/policy-strength.js";
import { outlierStrengthNote, type VerdictRegime } from "./strength-notes.js";

export function OutlierDetailPanel({
  row,
  strength,
  regime,
  onOpenApp,
}: {
  row: OutlierRow;
  strength: StrengthResolver | null;
  regime: VerdictRegime;
  onOpenApp: (appId: string) => void;
}) {
  /** Grounded verdict line for one finding, or null (ungrounded → keep the bare divergence). */
  const verdictLine = (dominantPolicyId: string, dominantPolicyName: string): string | null =>
    strength
      ? outlierStrengthVerdict(
          strength,
          { policyId: row.appPolicyId, policyName: row.appPolicyName },
          { policyId: dominantPolicyId, policyName: dominantPolicyName },
        ).line
      : null;

  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className="trace-kind">Policy outlier</div>
          <h2>{row.appName}</h2>
        </div>
      </div>

      <div className="cov-summary">
        <span className={`severity-chip ${row.severity === "default-while-peers-custom" ? "is-default-custom" : "is-differs"}`}>
          {row.severity}
        </span>{" "}
        · this app: {row.appPolicyName ?? "org default app sign-on policy"}
      </div>

      <h3>
        Divergent peer groups ({row.findingCount})
      </h3>
      <ul className="trace-apps">
        {row.findings.map((f) => {
          const line = verdictLine(f.dominantPolicyId, f.dominantPolicyName);
          return (
            <li key={f.groupId} className="outlier-finding">
              in <strong>{f.groupName}</strong> ({f.peerCount} apps): {f.dominantCount}/
              {f.peerCount} peers behind <strong>{f.dominantPolicyName}</strong>
              {line && <span className="strength-verdict">↳ {line}</span>}
            </li>
          );
        })}
        {row.findingCount > row.findings.length && (
          <li className="outlier-finding muted">
            …and {row.findingCount - row.findings.length} more peer groups
          </li>
        )}
      </ul>

      <button type="button" className="file-btn" onClick={() => onOpenApp(row.appId)}>
        View app in graph
      </button>

      <p className="hint outlier-note">{outlierStrengthNote(regime)}</p>
    </aside>
  );
}
