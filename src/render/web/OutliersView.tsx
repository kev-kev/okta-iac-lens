/**
 * OutliersView — the policy-outlier table (M10). One component for small AND large tenants: a
 * ranked, virtualized table is scale-independent, so there is no size fork. Rows are the pure
 * `findPolicyOutliers` output (same analysis the CLI renders); clicking a row opens its evidence
 * panel, and from there the app can be opened in the graph.
 */
import { useState } from "react";
import type { OutlierReport } from "../../analysis/policy-outliers.js";
import { VirtualList } from "./VirtualList.js";
import { OutlierDetailPanel } from "./OutlierDetailPanel.js";

export function OutliersView({
  report,
  onBack,
  onOpenApp,
}: {
  report: OutlierReport;
  onBack: () => void;
  onOpenApp: (appId: string) => void;
}) {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const selected = report.rows.find((r) => r.appId === selectedAppId) ?? null;

  return (
    <div className="explorer">
      <div className="explorer-main">
        <div className="focus-bar">
          <button type="button" className="clear-btn" onClick={onBack}>
            ← Back
          </button>
          <span className="meta">
            <strong>Policy outliers</strong> · {report.rows.length} app
            {report.rows.length === 1 ? "" : "s"} diverging · evaluated {report.groupsEvaluated} peer
            group{report.groupsEvaluated === 1 ? "" : "s"} (≥{report.minPeers} apps),{" "}
            {report.groupsWithDominant} with a dominant policy
          </span>
        </div>
        {report.rows.length === 0 ? (
          <div className="dropzone">
            <p>No outliers.</p>
            <p className="hint">
              {report.groupsEvaluated === 0
                ? `No group grants ${report.minPeers} or more apps, so there are no peer sets to compare.`
                : `Evaluated ${report.groupsEvaluated} peer group${report.groupsEvaluated === 1 ? "" : "s"} with ≥${report.minPeers} granted apps; ${report.groupsWithDominant} had a dominant auth policy and every app conformed to it.`}
            </p>
          </div>
        ) : (
          <>
            <div className="list-head">
              <span>ranked by divergence score (weaker-than-peers counts double)</span>
            </div>
            <VirtualList
              items={report.rows}
              rowHeight={40}
              height={560}
              keyOf={(r) => r.appId}
              renderRow={(r) => (
                <button
                  type="button"
                  className={`explorer-row${r.severity === "weaker-than-peers" ? " is-weak-gate" : ""}${
                    r.appId === selectedAppId ? " is-selected" : ""
                  }`}
                  onClick={() => setSelectedAppId(r.appId)}
                >
                  <span className="row-name">{r.appName}</span>
                  <span className="row-meta">
                    {r.severity} · {r.findingCount} peer group{r.findingCount === 1 ? "" : "s"} ·
                    score {r.score}
                  </span>
                </button>
              )}
            />
            <p className="hint outlier-note">
              Divergence compares <strong>which</strong> policy applies, not policy contents —
              custom-vs-custom mismatches may be intentional.
            </p>
          </>
        )}
      </div>
      {selected && <OutlierDetailPanel row={selected} onOpenApp={onOpenApp} />}
    </div>
  );
}
