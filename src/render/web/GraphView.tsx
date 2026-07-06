import { useEffect, useMemo } from "react";
import { ReactFlow, Background, Controls, Panel, useReactFlow } from "@xyflow/react";
import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { EdgeKind } from "../../core/model.js";
import type { CardModel } from "./derive-cards.js";
import type { CoverageBadges } from "./coverage-badges.js";
import type { AggregateNode } from "./build-focus-view.js";
import { COMPACT_SPACING, DEFAULT_SPACING, layoutGraph, NODE_HEIGHT } from "./layout.js";
import type { NodePosition } from "./layout.js";
import { edgeId } from "./highlight.js";
import type { HighlightSet } from "./highlight.js";
import { Legend, nodeTypes, ViewerContext } from "./nodes.js";

/**
 * Rendered inside <ReactFlow> so it can use the instance. On focus change: fitView frames the
 * graph horizontally ("balanced with graph length"), then we override the vertical position so
 * the focused card sits at viewport middle. Keyed to focusNodeId + node count so it re-runs when
 * the view changes.
 */
function CenterOnFocus({
  focusNodeId,
  positions,
  nodeCount,
}: {
  focusNodeId: string | null | undefined;
  positions: Map<string, NodePosition>;
  nodeCount: number;
}) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!focusNodeId) {
      rf.fitView({ padding: 0.15, maxZoom: 1 });
      return;
    }
    const pos = positions.get(focusNodeId);
    rf.fitView({ padding: 0.15, maxZoom: 1 });
    if (pos) {
      // Keep fitView's horizontal center + zoom; pin the focus card vertically centered.
      const vp = rf.getViewport();
      const width = window.innerWidth;
      const centerXFlow = (width / 2 - vp.x) / vp.zoom;
      rf.setCenter(centerXFlow, pos.y + NODE_HEIGHT / 2, { zoom: vp.zoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, nodeCount]);
  return null;
}

/** Only spine edges remain in the flow graph now (policies are card attributes). */
const EDGE_COLOR: Partial<Record<EdgeKind, string>> = {
  populates: "#94a3b8",
  grants: "#2563eb",
};

/** An unmanaged grants edge (a click-ops app assignment) is drawn in the "gap" hue. */
const UNMANAGED_EDGE_COLOR = "#f59e0b";

export interface GraphViewProps {
  cards: CardModel;
  highlight?: HighlightSet | null;
  /** The currently selected policy id (to emphasize its badge across every card it's on). */
  selectedPolicyId?: string | null;
  /** M5 coverage overlay maps, or null when no overlay is active. */
  badges?: CoverageBadges | null;
  /** M6 focus-view aggregates ("+N more" for truncated hubs), laid out by dagre beside hosts. */
  aggregates?: AggregateNode[];
  /** M6 focus mode: the focused node id — its card gets the FOCUS ring, and drives centering + compact layout. */
  focusNodeId?: string | null;
  showLabels?: boolean;
  onSelectGroup?: (groupId: string) => void;
  onSelectPolicy?: (policyId: string) => void;
  /** M6 focus mode: clicking a non-focused node re-focuses on it (overrides onSelectGroup when set). */
  onFocusNode?: (nodeId: string) => void;
  /** M6 focus mode: clicking the ALREADY-focused node clears focus (back to the list). */
  onDefocus?: () => void;
  /** M6 focus mode: clicking an aggregate opens its host's truncated-neighbor list. */
  onExpandAggregate?: (hostId: string) => void;
  onClear?: () => void;
}

export function GraphView({
  cards,
  highlight,
  selectedPolicyId,
  badges,
  aggregates,
  focusNodeId,
  showLabels = true,
  onSelectGroup,
  onSelectPolicy,
  onFocusNode,
  onDefocus,
  onExpandAggregate,
  onClear,
}: GraphViewProps) {
  const { flow, sessionPolicyByGroup, authPolicyByApp } = cards;
  // Focus views (focusNodeId set) pack tighter so a rank of neighbors fits the viewport.
  const spacing = focusNodeId != null ? COMPACT_SPACING : DEFAULT_SPACING;
  const positions = useMemo(
    () => layoutGraph(flow, aggregates ?? [], spacing),
    [flow, aggregates, spacing],
  );

  const nodes: RFNode[] = useMemo(() => {
    const real: RFNode[] = flow.nodes.map((n) => {
        const policy =
          n.kind === "Group"
            ? sessionPolicyByGroup.get(n.id)
            : n.kind === "App"
              ? authPolicyByApp.get(n.id)
              : undefined;
        return {
          id: n.id,
          type: "okta" as const,
          position: positions.get(n.id) ?? { x: 0, y: 0 },
          data: {
            label: n.name,
            kind: n.kind,
            active: highlight ? highlight.nodeIds.has(n.id) : undefined,
            policyName: policy?.name,
            policyId: policy?.id,
            policyActive: policy != null && policy.id === selectedPolicyId,
            bucket: badges?.bucketByNodeId.get(n.id),
            policyBucket: policy ? badges?.bucketByPolicyId.get(policy.id) : undefined,
            isFocus: n.id === focusNodeId,
          },
        };
      });
    // Aggregate pseudo-nodes ("+N more") — positioned by dagre like everything else.
    const aggs: RFNode[] = (aggregates ?? []).flatMap((agg) => {
      const pos = positions.get(agg.id);
      if (!pos) return [];
      return [
        {
          id: agg.id,
          type: "aggregate" as const,
          position: pos,
          data: { hiddenCount: agg.hiddenCount, hostId: agg.hostId },
        },
      ];
    });
    return [...real, ...aggs];
  }, [
    flow,
    positions,
    highlight,
    selectedPolicyId,
    badges,
    aggregates,
    focusNodeId,
    sessionPolicyByGroup,
    authPolicyByApp,
  ]);

  const edges: RFEdge[] = useMemo(() => {
    const real: RFEdge[] = flow.edges.map((e) => {
        const id = edgeId(e);
        const active = highlight ? highlight.edgeIds.has(id) : undefined;
        const dim = active === false;
        // An unmanaged grants edge (a click-ops assignment not in Terraform) is recolored.
        const unmanaged = badges?.bucketByEdgeId.get(id) === "unmanaged";
        const stroke = unmanaged ? UNMANAGED_EDGE_COLOR : (EDGE_COLOR[e.kind] ?? "#94a3b8");
        const label = unmanaged ? "grants · not in Terraform" : showLabels ? e.kind : undefined;
        return {
          id,
          source: e.from,
          target: e.to,
          label,
          animated: active === true,
          style: {
            stroke,
            strokeWidth: active === true || unmanaged ? 2.5 : 1.5,
            strokeDasharray: unmanaged ? "6 3" : e.kind === "populates" ? "6 4" : undefined,
            opacity: dim ? 0.12 : 1,
          },
          labelStyle: { fill: stroke, fontSize: 11, opacity: dim ? 0.15 : 1 },
          labelBgStyle: { fill: "#0b1220", fillOpacity: dim ? 0.1 : 0.85 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
        };
      });
    const aggEdges: RFEdge[] = (aggregates ?? []).flatMap((agg) =>
      positions.get(agg.hostId)
        ? [
            {
              id: `e:${agg.id}`,
              source: agg.hostId,
              target: agg.id,
              style: { stroke: "#64748b", strokeDasharray: "2 3" },
            },
          ]
        : [],
    );
    return [...real, ...aggEdges];
  }, [flow, highlight, showLabels, badges, aggregates, positions]);

  return (
    <div className="graph-canvas">
      <ViewerContext.Provider value={{ onSelectPolicy: (id) => onSelectPolicy?.(id) }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          panOnScroll
          nodesConnectable={false}
          onNodeClick={(_event, node) => {
            if (node.type === "aggregate") {
              onExpandAggregate?.(node.data.hostId as string);
            } else if (onFocusNode) {
              // focus mode: re-clicking the focused node clears it, otherwise re-focus.
              if (node.id === focusNodeId) onDefocus?.();
              else onFocusNode(node.id);
            } else if (node.data.kind === "Group") {
              onSelectGroup?.(node.id); // full-canvas mode: groups trace
            }
          }}
          onPaneClick={() => onClear?.()}
        >
          {onFocusNode && (
            <CenterOnFocus
              focusNodeId={focusNodeId}
              positions={positions}
              nodeCount={flow.nodes.length}
            />
          )}
          <Background />
          <Controls />
          <Panel position="top-left">
            <Legend />
          </Panel>
        </ReactFlow>
      </ViewerContext.Provider>
    </div>
  );
}
