import { useMemo } from "react";
import type { OktaGraph } from "../../core/model.js";
import type { UserTraceResult } from "../../core/access-paths.js";
import { deriveCards } from "./derive-cards.js";
import { buildUserAccessGraph } from "./user-access-graph.js";
import { GraphView } from "./GraphView.js";
import { UserTracePanel } from "./UserTracePanel.js";

/**
 * The VISUAL user-access story (M9): the user's slice of the tenant on the canvas (rules → groups
 * → apps, policy badges), reusing GraphView + deriveCards, alongside the textual UserTracePanel.
 * Works at any tenant size — the sub-graph is one person's neighborhood, bounded by construction.
 */
export function UserTraceView({
  graph,
  result,
  showLabels,
  onBack,
}: {
  graph: OktaGraph;
  result: UserTraceResult;
  showLabels: boolean;
  onBack: () => void;
}) {
  const subgraph = useMemo(() => buildUserAccessGraph(graph, result), [graph, result]);
  const cards = useMemo(() => deriveCards(subgraph), [subgraph]);

  return (
    <div className="focus-view">
      <div className="focus-bar">
        <button type="button" className="clear-btn" onClick={onBack}>
          ← Back
        </button>
        <span className="meta">
          Access for <strong>{result.user.login}</strong> · {result.apps.length} app
          {result.apps.length === 1 ? "" : "s"} via {result.viaGroups.length} group
          {result.viaGroups.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="workspace">
        <GraphView cards={cards} showLabels={showLabels} />
        <UserTracePanel graph={graph} result={result} onClear={onBack} />
      </div>
    </div>
  );
}
