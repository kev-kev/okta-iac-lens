import { useMemo } from "react";
import { ReactFlow, Background, Controls, Panel } from "@xyflow/react";
import type { Edge as RFEdge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { EdgeKind } from "../../core/model.js";
import type { CardModel } from "./derive-cards.js";
import { layoutGraph } from "./layout.js";
import { edgeId } from "./highlight.js";
import type { HighlightSet } from "./highlight.js";
import { Legend, nodeTypes, ViewerContext } from "./nodes.js";
import type { OktaFlowNode } from "./nodes.js";

/** Only spine edges remain in the flow graph now (policies are card attributes). */
const EDGE_COLOR: Partial<Record<EdgeKind, string>> = {
  populates: "#94a3b8",
  grants: "#2563eb",
};

export interface GraphViewProps {
  cards: CardModel;
  highlight?: HighlightSet | null;
  /** The currently selected policy id (to emphasize its badge across every card it's on). */
  selectedPolicyId?: string | null;
  showLabels?: boolean;
  onSelectGroup?: (groupId: string) => void;
  onSelectPolicy?: (policyId: string) => void;
  onClear?: () => void;
}

export function GraphView({
  cards,
  highlight,
  selectedPolicyId,
  showLabels = true,
  onSelectGroup,
  onSelectPolicy,
  onClear,
}: GraphViewProps) {
  const { flow, sessionPolicyByGroup, authPolicyByApp } = cards;
  const positions = useMemo(() => layoutGraph(flow), [flow]);

  const nodes: OktaFlowNode[] = useMemo(
    () =>
      flow.nodes.map((n) => {
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
          },
        };
      }),
    [flow, positions, highlight, selectedPolicyId, sessionPolicyByGroup, authPolicyByApp],
  );

  const edges: RFEdge[] = useMemo(
    () =>
      flow.edges.map((e) => {
        const id = edgeId(e);
        const active = highlight ? highlight.edgeIds.has(id) : undefined;
        const dim = active === false;
        const stroke = EDGE_COLOR[e.kind] ?? "#94a3b8";
        return {
          id,
          source: e.from,
          target: e.to,
          label: showLabels ? e.kind : undefined,
          animated: active === true,
          style: {
            stroke,
            strokeWidth: active === true ? 2.5 : 1.5,
            strokeDasharray: e.kind === "populates" ? "6 4" : undefined,
            opacity: dim ? 0.12 : 1,
          },
          labelStyle: { fill: stroke, fontSize: 11, opacity: dim ? 0.15 : 1 },
          labelBgStyle: { fill: "#0b1220", fillOpacity: dim ? 0.1 : 0.85 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
        };
      }),
    [flow, highlight, showLabels],
  );

  return (
    <div className="graph-canvas">
      <ViewerContext.Provider value={{ onSelectPolicy: (id) => onSelectPolicy?.(id) }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          panOnScroll
          nodesConnectable={false}
          onNodeClick={(_event, node) => {
            if (node.data.kind === "Group") onSelectGroup?.(node.id);
          }}
          onPaneClick={() => onClear?.()}
        >
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
