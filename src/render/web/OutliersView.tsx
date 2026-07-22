/**
 * OutliersView — the policy-outlier surface (M10). One component for small AND large tenants: a
 * ranked table (default) plus a Group×Policy heatmap toggle, both scale-independent. Rows/cells
 * come from the pure `findPolicyOutliers` / `buildOutlierMatrix` (the same analysis the CLI uses).
 * Table row → evidence panel → open app in graph; matrix cell → CohortList of its apps → focus.
 */
import { useMemo, useState } from "react";
import type { OktaGraph } from "../../core/model.js";
import type { OutlierReport } from "../../analysis/policy-outliers.js";
import { outlierStrengthVerdict, type StrengthResolver } from "../../analysis/policy-strength.js";
import type { GraphIndexes } from "./indexes.js";
import { buildOutlierMatrix } from "./outlier-matrix.js";
import { outlierStrengthNote, verdictRegime } from "./strength-notes.js";
import { VirtualList } from "./VirtualList.js";
import { OutlierDetailPanel } from "./OutlierDetailPanel.js";
import { OutlierMatrix } from "./OutlierMatrix.js";
import { CohortList } from "./CohortList.js";

export function OutliersView({
  report,
  graph,
  indexes,
  strength,
  onBack,
  onOpenApp,
}: {
  report: OutlierReport;
  graph: OktaGraph;
  indexes: GraphIndexes;
  /** M15 Phase D: captured-rule strength resolver, or null (pre-M15 export) → verdicts stay priors. */
  strength: StrengthResolver | null;
  onBack: () => void;
  onOpenApp: (appId: string) => void;
}) {
  const [mode, setMode] = useState<"table" | "matrix">("table");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ label: string; appIds: string[] } | null>(null);

  const selected = report.rows.find((r) => r.appId === selectedAppId) ?? null;
  const matrix = useMemo(() => (mode === "matrix" ? buildOutlierMatrix(graph) : null), [mode, graph]);
  const hasEvaluated = report.groupsEvaluated > 0;

  // Which strength regime is in play (M15 Phase D), computed through the SAME shared helper the CLI
  // uses so the web caveat can't overclaim: grounded only when ≥1 shown divergence has both bands.
  const anyGrounded = useMemo(
    () =>
      strength != null &&
      report.rows.some((r) =>
        r.findings.some(
          (f) =>
            outlierStrengthVerdict(
              strength,
              { policyId: r.appPolicyId, policyName: r.appPolicyName },
              { policyId: f.dominantPolicyId, policyName: f.dominantPolicyName },
            ).verdict.grounded,
        ),
      ),
    [strength, report],
  );
  const regime = verdictRegime(strength != null, anyGrounded);

  // A clicked matrix cell drills into its apps, reusing the same list the cohort overview uses.
  if (drill) {
    return (
      <div className="explorer">
        <CohortList
          label={drill.label}
          memberIds={drill.appIds}
          indexes={indexes}
          onFocus={onOpenApp}
          onBack={() => setDrill(null)}
        />
      </div>
    );
  }

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
          {hasEvaluated && (
            <span className="sort-toggle">
              <button
                type="button"
                className={`sort-opt${mode === "table" ? " is-active" : ""}`}
                onClick={() => setMode("table")}
              >
                Table
              </button>
              <button
                type="button"
                className={`sort-opt${mode === "matrix" ? " is-active" : ""}`}
                onClick={() => setMode("matrix")}
              >
                Matrix
              </button>
            </span>
          )}
        </div>

        {mode === "matrix" && matrix ? (
          <OutlierMatrix
            matrix={matrix}
            regime={regime}
            onOpenCell={(label, appIds) => setDrill({ label, appIds })}
          />
        ) : report.rows.length === 0 ? (
          <div className="dropzone">
            <p>No outliers.</p>
            <p className="hint">
              {report.groupsEvaluated === 0
                ? `No group grants ${report.minPeers} or more apps, so there are no peer sets to compare.`
                : `Evaluated ${report.groupsEvaluated} peer group${report.groupsEvaluated === 1 ? "" : "s"} with ≥${report.minPeers} granted apps; ${report.groupsWithDominant} had a dominant auth policy and every app conformed to it.`}
              {hasEvaluated && " Switch to Matrix to see the policy distribution."}
            </p>
          </div>
        ) : (
          <>
            <div className="list-head">
              <span>ranked by divergence score (default-while-peers-custom counts double)</span>
            </div>
            <VirtualList
              items={report.rows}
              rowHeight={40}
              height={560}
              keyOf={(r) => r.appId}
              renderRow={(r) => (
                <button
                  type="button"
                  className={`explorer-row${r.severity === "default-while-peers-custom" ? " is-default-gate" : ""}${
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
              custom-vs-custom mismatches may be intentional. {outlierStrengthNote(regime)}
            </p>
          </>
        )}
      </div>
      {mode === "table" && selected && (
        <OutlierDetailPanel
          row={selected}
          strength={strength}
          regime={regime}
          onOpenApp={onOpenApp}
        />
      )}
    </div>
  );
}
