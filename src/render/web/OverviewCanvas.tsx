/**
 * OverviewCanvas — the aggregated cohort landing for large tenants. Three lanes (Rules → Groups
 * → Apps) of cohort meta-cards, joined by ribbons whose width/label is the aggregated assignment
 * count. 5–15 nodes total: legible by construction, zero spaghetti. Click a cohort to drill into
 * its member list. Data is the pure CohortModel (see cohorts.ts).
 */
import { useMemo } from "react";
import { ReactFlow, Background, Handle, Position } from "@xyflow/react";
import type { Edge as RFEdge, Node as RFNode, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Cohort, CohortLane, CohortModel } from "./cohorts.js";

const LANE_X: Record<CohortLane, number> = { rule: 0, group: 360, app: 720 };
const ROW_H = 118;

interface CohortNodeData extends Record<string, unknown> {
  cohort: Cohort;
}
type CohortFlowNode = RFNode<CohortNodeData, "cohort">;

function CohortNode({ data }: NodeProps<CohortFlowNode>) {
  const c = data.cohort;
  return (
    <div className={`cohort-node lane-${c.lane}`} title="Browse this cohort">
      <Handle id="t" type="target" position={Position.Left} />
      <Handle id="s" type="source" position={Position.Right} />
      <div className="cohort-count">{c.memberIds.length.toLocaleString()}</div>
      <div className="cohort-label">{c.label}</div>
      {c.sublabel && <div className="cohort-sublabel">{c.sublabel}</div>}
    </div>
  );
}

const nodeTypes = { cohort: CohortNode };

/** Ribbon width from an aggregated count (log-scaled so 60k doesn't dwarf 12). */
function ribbonWidth(count: number): number {
  return Math.max(1, Math.min(10, 1 + Math.log10(count + 1) * 2));
}

export function OverviewCanvas({
  model,
  onSelectCohort,
}: {
  model: CohortModel;
  onSelectCohort: (cohortId: string) => void;
}) {
  const nodes: CohortFlowNode[] = useMemo(() => {
    const perLane: Record<CohortLane, number> = { rule: 0, group: 0, app: 0 };
    return model.cohorts.map((c) => {
      const row = perLane[c.lane]++;
      return {
        id: c.id,
        type: "cohort" as const,
        position: { x: LANE_X[c.lane], y: 40 + row * ROW_H },
        data: { cohort: c },
      };
    });
  }, [model]);

  const edges: RFEdge[] = useMemo(
    () =>
      model.ribbons.map((r) => ({
        id: `${r.from}->${r.to}`,
        source: r.from,
        target: r.to,
        sourceHandle: "s",
        targetHandle: "t",
        label: r.count.toLocaleString(),
        style: { stroke: "#475569", strokeWidth: ribbonWidth(r.count) },
        labelStyle: { fill: "#94a3b8", fontSize: 10 },
        labelBgStyle: { fill: "#0b1220", fillOpacity: 0.8 },
      })),
    [model],
  );

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        panOnScroll
        nodesConnectable={false}
        onNodeClick={(_e, node) => onSelectCohort(node.id)}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
