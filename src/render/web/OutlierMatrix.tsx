/**
 * OutlierMatrix — the Group×Policy heatmap (M10 stretch). A bounded table (columns ≤ 8, rows ≤ 30
 * by construction in buildOutlierMatrix) so it never scales with org size. Each cell's heat = the
 * share of that group's apps on that policy; the dominant cell is outlined; divergent cells are
 * tinted (amber = weaker-than-peers, slate = differs). Clicking a non-empty cell drills into its
 * apps via the shared CohortList.
 */
import type { MatrixCell, OutlierMatrix as MatrixModel } from "./outlier-matrix.js";

/** Heat as an rgba fill: base blue for conforming, amber/slate for the flagged divergence. */
function cellStyle(cell: MatrixCell): React.CSSProperties {
  if (cell.count === 0) return {};
  const alpha = 0.15 + 0.55 * cell.share;
  const rgb =
    cell.severity === "weaker-than-peers"
      ? "245, 158, 11" // amber (--bucket-unmanaged)
      : cell.severity === "differs-from-peers"
        ? "148, 163, 184" // slate
        : "37, 99, 235"; // blue (--kind-Group) — conforming / dominant
  return { backgroundColor: `rgba(${rgb}, ${alpha.toFixed(3)})` };
}

export function OutlierMatrix({
  matrix,
  onOpenCell,
}: {
  matrix: MatrixModel;
  onOpenCell: (label: string, appIds: string[]) => void;
}) {
  return (
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th className="matrix-corner">Group ＼ Policy</th>
            {matrix.columns.map((c) => (
              <th key={c.id} className={`matrix-col${c.synthetic ? " is-synthetic" : ""}`} title={c.label}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.groupId}>
              <th className="matrix-row-head" title={row.groupName}>
                {row.groupName} <span className="matrix-peer">({row.peerCount})</span>
              </th>
              {row.cells.map((cell, i) => {
                const col = matrix.columns[i]!;
                const cls =
                  "matrix-cell" +
                  (cell.isDominant ? " is-dominant" : "") +
                  (cell.severity ? ` sev-${cell.severity}` : "") +
                  (cell.count > 0 ? " is-clickable" : "");
                const title =
                  `${row.groupName} · ${col.label}: ${cell.count}/${row.peerCount}` +
                  (cell.isDominant ? " (dominant)" : cell.severity ? ` (${cell.severity})` : "");
                return cell.count > 0 ? (
                  <td
                    key={col.id}
                    className={cls}
                    style={cellStyle(cell)}
                    title={title}
                    onClick={() => onOpenCell(`${row.groupName} · ${col.label}`, cell.appIds)}
                  >
                    {cell.count}
                  </td>
                ) : (
                  <td key={col.id} className="matrix-cell is-empty" title={title} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint outlier-note">
        Heat = share of the group's apps on that policy. The <span className="matrix-key is-dominant" />{" "}
        outlined cell is the dominant policy; <span className="matrix-key sev-weaker-than-peers" /> weaker-than-peers,{" "}
        <span className="matrix-key sev-differs-from-peers" /> differs. Click a cell to list its apps.
        {matrix.hiddenRowCount > 0 && ` · ${matrix.hiddenRowCount} more group(s) not shown (largest audiences first).`}
      </p>
    </div>
  );
}
