import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import type { NodeKind } from "../../core/model.js";

export interface OktaNodeData extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  /** Set once a group is traced: true = in the highlight set, false = dimmed. Undefined = no trace active. */
  active?: boolean;
}

export type OktaFlowNode = Node<OktaNodeData, "okta">;

/** Human-facing kind label shown on each node. */
const KIND_LABEL: Record<NodeKind, string> = {
  Group: "Group",
  App: "App",
  GroupRule: "Group rule",
  GlobalSessionPolicy: "Global session policy",
  AppAuthPolicy: "App auth policy",
};

export function OktaNode({ data }: NodeProps<OktaFlowNode>) {
  const dimmed = data.active === false;
  return (
    <div className={`okta-node kind-${data.kind}${dimmed ? " is-dimmed" : ""}`}>
      {/* Spine edges anchor left/right; policy edges (appliesTo/protects) anchor top/bottom.
          Handle ids are referenced by GraphView's EDGE_HANDLES. Handles are hidden via CSS —
          they anchor edges, not user connections (nodesConnectable is off). */}
      <Handle id="t-left" type="target" position={Position.Left} />
      <Handle id="s-right" type="source" position={Position.Right} />
      <Handle id="t-top" type="target" position={Position.Top} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} />
      <div className="okta-node-kind">{KIND_LABEL[data.kind]}</div>
      <div className="okta-node-label">{data.label}</div>
    </div>
  );
}

export const nodeTypes = { okta: OktaNode };

/** Legend — names the node kinds and, crucially, keeps the two policy LAYERS distinct. */
export function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Access graph</div>
      <ul className="legend-nodes">
        <li><span className="swatch kind-GroupRule" /> Group rule</li>
        <li><span className="swatch kind-Group" /> Group</li>
        <li><span className="swatch kind-App" /> App</li>
      </ul>
      <div className="legend-title">Two policy layers</div>
      <ul className="legend-edges">
        <li>
          <span className="edge-swatch edge-appliesTo" />
          <span><strong>Global session policy</strong> → group<br />gates sign-in to Okta</span>
        </li>
        <li>
          <span className="edge-swatch edge-protects" />
          <span><strong>App auth policy</strong> → app<br />gates one specific app</span>
        </li>
        <li>
          <span className="edge-swatch edge-grants" />
          <span>group <strong>grants</strong> app</span>
        </li>
        <li>
          <span className="edge-swatch edge-populates" />
          <span>rule <strong>populates</strong> group</span>
        </li>
      </ul>
      <div className="legend-note">
        An app with no app-auth-policy edge uses the <em>org default</em> app policy — not
        "unprotected".
      </div>
    </div>
  );
}
