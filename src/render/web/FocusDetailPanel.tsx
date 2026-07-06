/**
 * FocusDetailPanel — complete orientation on the focused resource. The canvas is a BOUNDED
 * neighborhood (≤~12 shown neighbors); this panel gives the FULL picture, computed from the
 * whole graph via the same pure core the CLI uses (trace / traceApp), so it never disagrees.
 * Long lists (a hub app's hundreds of granting groups) are virtualized. Rows click to re-focus.
 */
import { useMemo } from "react";
import type { GraphNode, OktaGraph } from "../../core/model.js";
import { trace, traceApp } from "../../core/access-paths.js";
import type { CoverageBucket } from "../../analysis/coverage.js";
import { VirtualList } from "./VirtualList.js";

interface Detail {
  kind: string;
  /** The primary connection list (apps for a group, groups for an app/rule). */
  listHeading: string;
  rows: { id: string; name: string; kind: string }[];
  /** The relevant policy gate, human-readable. */
  gateLabel: string;
  gateValue: string;
  /** Optional secondary short list (an app's populating rules). */
  secondary?: { heading: string; rows: { id: string; name: string }[] };
}

function detailFor(graph: OktaGraph, node: GraphNode): Detail | null {
  if (node.kind === "Group") {
    const r = trace(graph, node.id);
    return {
      kind: "Group",
      listHeading: "Grants apps",
      rows: r.apps.map((a) => ({ id: a.id, name: a.name, kind: "App" })),
      gateLabel: "Session policy",
      gateValue: r.globalSessionPolicy?.name ?? "(none)",
    };
  }
  if (node.kind === "App") {
    const r = traceApp(graph, node.id);
    return {
      kind: "App",
      listHeading: "Reached by groups",
      rows: r.grantingGroups.map((g) => ({ id: g.id, name: g.name, kind: "Group" })),
      gateLabel: "Auth policy",
      gateValue: r.authPolicy?.name ?? "org default",
      secondary: {
        heading: "Populated by rules",
        rows: r.populatingRules.map((rule) => ({ id: rule.id, name: rule.name })),
      },
    };
  }
  if (node.kind === "GroupRule") {
    const groupIds = new Set(
      graph.edges.filter((e) => e.kind === "populates" && e.from === node.id).map((e) => e.to),
    );
    const rows = graph.nodes
      .filter((n) => n.kind === "Group" && groupIds.has(n.id))
      .map((g) => ({ id: g.id, name: g.name, kind: "Group" }));
    return { kind: "Group rule", listHeading: "Populates groups", rows, gateLabel: "", gateValue: "" };
  }
  return null;
}

const BUCKET_LABEL: Record<CoverageBucket, string> = {
  managed: "Managed in Terraform",
  unmanaged: "Not in Terraform",
  stale: "Stale (state only)",
  excluded: "Okta-managed",
};

export function FocusDetailPanel({
  graph,
  focusId,
  bucketByNodeId,
  onFocus,
}: {
  graph: OktaGraph;
  focusId: string;
  bucketByNodeId?: Map<string, CoverageBucket>;
  onFocus: (nodeId: string) => void;
}) {
  const node = useMemo(() => graph.nodes.find((n) => n.id === focusId) ?? null, [graph, focusId]);
  const detail = useMemo(() => (node ? detailFor(graph, node) : null), [graph, node]);
  if (!node || !detail) return null;

  const bucket = bucketByNodeId?.get(focusId);

  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className="trace-kind">{detail.kind}</div>
          <h2>{node.name}</h2>
        </div>
      </div>

      <div className="cov-summary">
        {detail.rows.length} {detail.listHeading.toLowerCase()}
        {detail.gateLabel ? ` · ${detail.gateLabel}: ${detail.gateValue}` : ""}
        {bucket ? ` · ${BUCKET_LABEL[bucket]}` : ""}
      </div>

      {detail.secondary && detail.secondary.rows.length > 0 && (
        <>
          <h3>{detail.secondary.heading}</h3>
          <ul className="trace-apps">
            {detail.secondary.rows.map((r) => (
              <li key={r.id}>
                <button type="button" className="link-row" onClick={() => onFocus(r.id)}>
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>
        {detail.listHeading} ({detail.rows.length})
      </h3>
      {detail.rows.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <VirtualList
          items={detail.rows}
          rowHeight={40}
          height={420}
          keyOf={(r) => r.id}
          renderRow={(r) => (
            <button type="button" className="explorer-row" onClick={() => onFocus(r.id)}>
              <span className="row-name">{r.name}</span>
              <span className="row-meta">{r.kind}</span>
            </button>
          )}
        />
      )}
    </aside>
  );
}
