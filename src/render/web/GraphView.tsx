import { useMemo } from "react";
import { ReactFlow, Background, Controls, Panel } from "@xyflow/react";
import type { Edge as RFEdge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { EdgeKind, OktaGraph } from "../../core/model.js";
import { layoutGraph } from "./layout.js";
import { edgeId } from "./highlight.js";
import type { HighlightSet } from "./highlight.js";
import { Legend, nodeTypes } from "./nodes.js";
import type { OktaFlowNode } from "./nodes.js";

/** Edge color per kind. The two policy layers get their own hues (amber vs red), matched to
 * their policy nodes, so `appliesTo` (session) and `protects` (app) never read as one thing. */
const EDGE_COLOR: Record<EdgeKind, string> = {
  populates: "#94a3b8",
  grants: "#2563eb",
  appliesTo: "#d97706",
  protects: "#dc2626",
};

export interface GraphViewProps {
  graph: OktaGraph;
  /** When set, nodes/edges in the set are emphasized and the rest dimmed. null/undefined = no trace. */
  highlight?: HighlightSet | null;
  /** Show the per-edge kind labels ("grants", "protects", …). Default true. */
  showLabels?: boolean;
  onNodeClick?: (nodeId: string) => void;
  onPaneClick?: () => void;
}

export function GraphView({
  graph,
  highlight,
  showLabels = true,
  onNodeClick,
  onPaneClick,
}: GraphViewProps) {
  const positions = useMemo(() => layoutGraph(graph), [graph]);

  const nodes: OktaFlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "okta" as const,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: {
          label: n.name,
          kind: n.kind,
          active: highlight ? highlight.nodeIds.has(n.id) : undefined,
        },
      })),
    [graph, positions, highlight],
  );

  const edges: RFEdge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const id = edgeId(e);
        const active = highlight ? highlight.edgeIds.has(id) : undefined;
        const dim = active === false;
        return {
          id,
          source: e.from,
          target: e.to,
          label: showLabels ? e.kind : undefined,
          animated: active === true,
          style: {
            stroke: EDGE_COLOR[e.kind],
            strokeWidth: active === true ? 2.5 : 1.5,
            strokeDasharray: e.kind === "populates" ? "6 4" : undefined,
            opacity: dim ? 0.12 : 1,
          },
          // Dim the label bubble in lockstep with its edge, so an out-of-flow label
          // (e.g. Contractors' unrelated `populates`) recedes instead of floating on top.
          labelStyle: { fill: EDGE_COLOR[e.kind], fontSize: 11, opacity: dim ? 0.15 : 1 },
          labelBgStyle: {
            fill: "#0b1220",
            fillOpacity: dim ? 0.1 : 0.85,
            stroke: EDGE_COLOR[e.kind],
            strokeOpacity: dim ? 0.1 : 0.5,
          },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
        };
      }),
    [graph, highlight, showLabels],
  );

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        panOnScroll
        onNodeClick={(_event, node) => onNodeClick?.(node.id)}
        onPaneClick={() => onPaneClick?.()}
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <Legend />
        </Panel>
      </ReactFlow>
    </div>
  );
}
