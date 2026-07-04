/**
 * CoveragePanel — the default panel when the overlay is on and nothing is selected. Shows the
 * coverage %, per-kind rows, the stale + excluded lists (stale is panel-only by design), and
 * the recommended steps. Recommendations come from the same pure `recommend()` the CLI uses.
 */
import type { CoverageReport } from "../../analysis/coverage.js";
import { recommend } from "../../analysis/recommendations.js";

function pct(v: number | null): string {
  return v === null ? "n/a" : `${Math.round(v * 100)}%`;
}

export function CoveragePanel({ report }: { report: CoverageReport }) {
  const o = report.overall;
  const recs = recommend(report);
  const stale = report.items.filter((i) => i.bucket === "stale");
  const excluded = report.items.filter((i) => i.bucket === "excluded");

  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className="trace-kind">IaC coverage</div>
          <h2 className="cov-pct">{pct(o.coverage)}</h2>
        </div>
      </div>
      <div className="cov-summary">
        {o.managed} managed · {o.unmanaged} unmanaged · {o.stale} stale · {o.excluded} excluded
      </div>

      <h3>By kind</h3>
      <ul className="cov-kinds">
        {report.perKind.map((k) => (
          <li key={k.kind}>
            <span>{k.kind}</span>
            <span className="muted">
              {k.managed}/{k.managed + k.unmanaged}
              {k.coverage !== null ? ` · ${pct(k.coverage)}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {stale.length > 0 && (
        <>
          <h3>Stale — in Terraform, not the tenant ({stale.length})</h3>
          <ul className="trace-apps">
            {stale.map((i) => (
              <li key={`${i.kind}:${i.key}`}>
                <span className="app-name">{i.name}</span>
                <span className="muted">{i.kind}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {excluded.length > 0 && (
        <>
          <h3>Excluded — Okta-managed ({excluded.length})</h3>
          <ul className="trace-apps">
            {excluded.map((i) => (
              <li key={`${i.kind}:${i.key}`}>
                <span className="app-name">{i.name}</span>
                {i.reason && <span className="muted">{i.reason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Recommended steps</h3>
      <ul className="cov-recs">
        {recs.map((r, idx) => (
          <li key={idx} className={`rec rec-${r.severity}`}>
            <div className="rec-title">{r.title}</div>
            <div className="rec-detail">{r.detail}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
