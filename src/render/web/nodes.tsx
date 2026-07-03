import { createContext, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import type { NodeKind } from "../../core/model.js";

/** Handlers custom nodes reach via context (React Flow renders nodes below this provider). */
export interface ViewerHandlers {
  onSelectPolicy: (policyId: string) => void;
}
export const ViewerContext = createContext<ViewerHandlers | null>(null);

export interface OktaNodeData extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  /** true = in the current highlight set, false = dimmed, undefined = no selection active. */
  active?: boolean;
  /** Group: its session policy name. App: its auth policy name (or "org default"). */
  policyName?: string;
  /** Policy id, if any. Undefined on an app means the org-default policy (not unprotected). */
  policyId?: string;
  /** This card's policy is the currently selected one (badge emphasized). */
  policyActive?: boolean;
}

export type OktaFlowNode = Node<OktaNodeData, "okta">;

const KIND_LABEL: Record<NodeKind, string> = {
  Group: "Group",
  App: "App",
  GroupRule: "Group rule",
  GlobalSessionPolicy: "Global session policy",
  AppAuthPolicy: "App auth policy",
};

/** A policy shown as a card attribute. The two layers get distinct styling and labels — a
 * group's Session policy and an app's Auth policy must never read as one generic "policy". */
function PolicyBadge({
  layer,
  name,
  policyId,
  active,
}: {
  layer: "session" | "auth";
  name: string;
  policyId?: string;
  active?: boolean;
}) {
  const ctx = useContext(ViewerContext);
  const label = layer === "session" ? "Session policy" : "Auth policy";
  const className = `policy-badge badge-${layer}${active ? " is-selected" : ""}`;

  // No policyId => a non-interactive badge: a group with no session policy, or an app on the
  // org-default app policy. (Org default is a real state, not "unprotected".)
  if (!policyId) {
    return (
      <div className={`${className} is-default`}>
        <span className="badge-label">{label}</span>
        <span className="badge-value">{name}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={`Highlight everything ${name} governs`}
      onClick={(e) => {
        e.stopPropagation(); // don't also trigger the card's group-trace
        ctx?.onSelectPolicy(policyId);
      }}
    >
      <span className="badge-label">{label}</span>
      <span className="badge-value">{name}</span>
    </button>
  );
}

export function OktaNode({ data }: NodeProps<OktaFlowNode>) {
  const dimmed = data.active === false;
  return (
    <div className={`okta-node kind-${data.kind}${dimmed ? " is-dimmed" : ""}`}>
      {/* Handles only anchor edges (nodesConnectable off); hidden via CSS. dagre lays out
          left->right, so incoming edges enter left, outgoing leave right. */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="okta-node-kind">{KIND_LABEL[data.kind]}</div>
      <div className="okta-node-label">{data.label}</div>
      {data.kind === "Group" && (
        <PolicyBadge
          layer="session"
          name={data.policyName ?? "(none)"}
          policyId={data.policyId}
          active={data.policyActive}
        />
      )}
      {data.kind === "App" && (
        <PolicyBadge
          layer="auth"
          name={data.policyName ?? "org default"}
          policyId={data.policyId}
          active={data.policyActive}
        />
      )}
    </div>
  );
}

export const nodeTypes = { okta: OktaNode };

/** Legend: the resource flow, plus the two policy layers as card attributes (kept distinct). */
export function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Access flow</div>
      <ul className="legend-nodes">
        <li>
          <span className="swatch kind-GroupRule" /> Group rule <span className="arrow">→</span>{" "}
          populates a group
        </li>
        <li>
          <span className="swatch kind-Group" /> Group <span className="arrow">→</span> grants apps
        </li>
        <li>
          <span className="swatch kind-App" /> App
        </li>
      </ul>
      <div className="legend-title">Two policy layers (on the cards)</div>
      <ul className="legend-badges">
        <li>
          <span className="badge-chip badge-session" /> <strong>Session policy</strong> on a group
          — gates sign-in to Okta
        </li>
        <li>
          <span className="badge-chip badge-auth" /> <strong>Auth policy</strong> on an app — gates
          that one app
        </li>
      </ul>
      <div className="legend-note">
        An app's auth policy of <em>“org default”</em> means it uses the org-wide default app
        policy — not that it's unprotected. Click a policy badge to highlight everything it governs.
      </div>
    </div>
  );
}
