/**
 * HiddenNeighborsPanel — what a "+N more" aggregate stands for, as a browsable list (the plan's
 * "aggregate click = panel list"). Scale-independent: a virtualized list, never drawn as edges.
 * Clicking a row re-focuses on that neighbor.
 */
import type { GraphNode } from "../../core/model.js";
import { VirtualList } from "./VirtualList.js";

export function HiddenNeighborsPanel({
  hostName,
  neighbors,
  onFocus,
  onClear,
}: {
  hostName: string;
  neighbors: GraphNode[];
  onFocus: (nodeId: string) => void;
  onClear: () => void;
}) {
  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className="trace-kind">Not shown on canvas</div>
          <h2>{hostName}</h2>
        </div>
        <button type="button" className="clear-btn" onClick={onClear}>
          Close
        </button>
      </div>
      <h3>{neighbors.length} more connected resources</h3>
      <VirtualList
        items={neighbors}
        rowHeight={40}
        height={460}
        keyOf={(n) => n.id}
        renderRow={(n) => (
          <button type="button" className="explorer-row" onClick={() => onFocus(n.id)}>
            <span className="row-name">{n.name}</span>
            <span className="row-meta">{n.kind}</span>
          </button>
        )}
      />
      <p className="panel-note">Click a resource to focus on it.</p>
    </aside>
  );
}
