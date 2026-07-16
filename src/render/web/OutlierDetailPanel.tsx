/**
 * OutlierDetailPanel — the evidence for one outlier row: which peer groups diverge and what
 * their dominant policy is ("in Engineering (11 apps): 9/11 peers behind Strict-Auth"). All data
 * comes pre-resolved on the OutlierRow — no graph joins here. "Org default" is the org-wide
 * default app sign-on policy, never "no auth".
 */
import type { OutlierRow } from "../../analysis/policy-outliers.js";

export function OutlierDetailPanel({
  row,
  onOpenApp,
}: {
  row: OutlierRow;
  onOpenApp: (appId: string) => void;
}) {
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
        {row.findings.map((f) => (
          <li key={f.groupId} className="outlier-finding">
            in <strong>{f.groupName}</strong> ({f.peerCount} apps): {f.dominantCount}/{f.peerCount}{" "}
            peers behind <strong>{f.dominantPolicyName}</strong>
          </li>
        ))}
        {row.findingCount > row.findings.length && (
          <li className="outlier-finding muted">
            …and {row.findingCount - row.findings.length} more peer groups
          </li>
        )}
      </ul>

      <button type="button" className="file-btn" onClick={() => onOpenApp(row.appId)}>
        View app in graph
      </button>

      <p className="hint outlier-note">
        Gate strength is a heuristic prior (org-default vs custom policy), not a factor-based verdict
        (M15). This flags a divergence, not a proven weakness.
      </p>
    </aside>
  );
}
