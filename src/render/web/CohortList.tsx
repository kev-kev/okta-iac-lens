/**
 * CohortList — the members of a clicked overview cohort, as a browsable virtualized list.
 * Scale-independent (thousands of rows are fine); a row click drills into that resource's
 * depth-1 focus view. This is the middle rung of the overview → list → focus drill path.
 */
import { useMemo, useState } from "react";
import type { GraphNode } from "../../core/model.js";
import type { GraphIndexes } from "./indexes.js";
import { VirtualList } from "./VirtualList.js";

export function CohortList({
  label,
  memberIds,
  indexes,
  onFocus,
  onBack,
}: {
  label: string;
  memberIds: string[];
  indexes: GraphIndexes;
  onFocus: (nodeId: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const nodes = useMemo(
    () =>
      memberIds
        .map((id) => indexes.nodeById.get(id))
        .filter((n): n is GraphNode => n != null),
    [memberIds, indexes],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((n) => `${n.name} ${n.id}`.toLowerCase().includes(q));
  }, [nodes, query]);

  return (
    <div className="explorer-main">
      <div className="focus-bar">
        <button type="button" className="clear-btn" onClick={onBack}>
          ← Overview
        </button>
        <span className="meta">
          <strong>{label}</strong> · {nodes.length.toLocaleString()} resources
        </span>
      </div>
      <input
        className="search"
        placeholder={`Filter ${label.toLowerCase()}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="list-head">
        {rows.length.toLocaleString()} {rows.length === 1 ? "match" : "matches"}
      </div>
      <VirtualList
        items={rows}
        rowHeight={40}
        height={560}
        keyOf={(n) => n.id}
        renderRow={(n) => (
          <button type="button" className="explorer-row" onClick={() => onFocus(n.id)}>
            <span className="row-name">{n.name}</span>
            <span className="row-meta">{n.kind}</span>
          </button>
        )}
      />
    </div>
  );
}
