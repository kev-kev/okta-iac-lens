import { useCallback, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { trace } from "../../core/access-paths.js";
import type { TraceResult } from "../../core/access-paths.js";
import type { GraphEnvelope } from "../envelope.js";
import { EnvelopeError, parseEnvelope } from "./parse-envelope.js";
import { highlightForTrace } from "./highlight.js";
import { GraphView } from "./GraphView.js";
import { TracePanel } from "./TracePanel.js";

export function App() {
  const [envelope, setEnvelope] = useState<GraphEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const load = useCallback(async (file: File) => {
    try {
      const parsed = parseEnvelope(JSON.parse(await file.text()));
      setEnvelope(parsed);
      setSelectedGroupId(null);
      setError(null);
    } catch (e) {
      setEnvelope(null);
      setSelectedGroupId(null);
      if (e instanceof EnvelopeError) setError(e.message);
      else if (e instanceof SyntaxError) setError("That file isn't valid JSON.");
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void load(file);
    },
    [load],
  );

  const graph = envelope?.graph ?? null;

  /** Only Group nodes can be traced; other kinds are inspect-only (plan rail). */
  const groupIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of graph?.nodes ?? []) if (n.kind === "Group") s.add(n.id);
    return s;
  }, [graph]);

  const traceResult = useMemo<TraceResult | null>(() => {
    if (!graph || !selectedGroupId) return null;
    try {
      return trace(graph, selectedGroupId);
    } catch {
      return null; // selected group no longer present (e.g. after loading a new graph)
    }
  }, [graph, selectedGroupId]);

  const highlight = useMemo(
    () => (traceResult ? highlightForTrace(traceResult) : null),
    [traceResult],
  );

  const onNodeClick = useCallback(
    (nodeId: string) => {
      if (groupIds.has(nodeId)) setSelectedGroupId(nodeId);
    },
    [groupIds],
  );

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="app-header">
        <h1>okta-iac-lens</h1>
        <label className="file-btn">
          Open graph…
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
            }}
          />
        </label>
        {envelope && (
          <span className="meta">
            source: {envelope.source} · {envelope.graph.nodes.length} nodes ·{" "}
            {envelope.graph.edges.length} edges · click a group to trace
          </span>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

      {graph ? (
        <div className="workspace">
          <GraphView
            graph={graph}
            highlight={highlight}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedGroupId(null)}
          />
          {traceResult && (
            <TracePanel result={traceResult} onClear={() => setSelectedGroupId(null)} />
          )}
        </div>
      ) : (
        <div className="dropzone">
          <p>
            Drop a graph JSON here, or use <strong>Open graph…</strong>
          </p>
          <p className="hint">
            Generate one with <code>npm run dev -- export --state &lt;tfstate&gt;</code>
          </p>
        </div>
      )}
    </div>
  );
}
