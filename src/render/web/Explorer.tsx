/**
 * Explorer — the query-first landing surface for large tenants (C half of M6). No canvas: a
 * search box + per-kind virtualized inventory + the coverage panel. Every render is
 * scale-independent (a list, not a graph). Clicking a focusable row hands off to the focus
 * canvas. This is the entry point above AUTO_THRESHOLD; small tenants never see it.
 */
import { useMemo, useState } from "react";
import type { GraphNode, NodeKind, OktaGraph } from "../../core/model.js";
import type { CoverageBucket, SlimCoverageReport } from "../../analysis/coverage.js";
import type { GraphIndexes } from "./indexes.js";
import { CoveragePanel } from "./CoveragePanel.js";
import { VirtualList } from "./VirtualList.js";

const KINDS: { kind: NodeKind; label: string }[] = [
  { kind: "Group", label: "Groups" },
  { kind: "App", label: "Apps" },
  { kind: "GroupRule", label: "Rules" },
  { kind: "GlobalSessionPolicy", label: "Session policies" },
  { kind: "AppAuthPolicy", label: "App policies" },
];

/** Only flow kinds have a meaningful neighborhood to focus; policies are attributes. */
const FOCUSABLE: ReadonlySet<NodeKind> = new Set(["Group", "App", "GroupRule"]);

export function Explorer({
  graph,
  indexes,
  coverage,
  onFocus,
}: {
  graph: OktaGraph;
  indexes: GraphIndexes;
  coverage: SlimCoverageReport | null;
  onFocus: (nodeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<NodeKind>("Group");

  const bucketByNodeId = useMemo(() => {
    const m = new Map<string, CoverageBucket>();
    if (coverage) {
      for (const it of coverage.items) if (it.kind !== "AppGroupAssignment") m.set(it.key, it.bucket);
    }
    return m;
  }, [coverage]);

  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    for (const n of graph.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graph]);

  const searching = query.trim().length > 0;
  const rows: GraphNode[] = useMemo(() => {
    if (searching) return indexes.search(query, 200);
    return graph.nodes.filter((n) => n.kind === tab);
  }, [searching, query, indexes, graph, tab]);

  return (
    <div className="explorer">
      <div className="explorer-main">
        <input
          className="search"
          placeholder="Search groups, apps, rules, policies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!searching && (
          <div className="kind-tabs">
            {KINDS.filter(({ kind }) => (counts.get(kind) ?? 0) > 0).map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                className={`kind-tab${tab === kind ? " is-active" : ""}`}
                onClick={() => setTab(kind)}
              >
                {label} <span className="tab-count">{counts.get(kind)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="list-head">
          {searching ? `${rows.length} match${rows.length === 1 ? "" : "es"}` : `${rows.length} rows`}
        </div>
        <VirtualList
          items={rows}
          rowHeight={40}
          height={540}
          keyOf={(n) => n.id}
          renderRow={(n) => {
            const bucket = bucketByNodeId.get(n.id);
            const focusable = FOCUSABLE.has(n.kind);
            const meta = `${n.kind}${bucket && bucket !== "managed" ? ` · ${bucket}` : ""}`;
            return focusable ? (
              <button type="button" className="explorer-row" onClick={() => onFocus(n.id)}>
                <span className="row-name">{n.name}</span>
                <span className="row-meta">{meta}</span>
              </button>
            ) : (
              <div className="explorer-row is-static">
                <span className="row-name">{n.name}</span>
                <span className="row-meta">{meta}</span>
              </div>
            );
          }}
        />
      </div>
      {coverage && <CoveragePanel report={coverage} />}
    </div>
  );
}
