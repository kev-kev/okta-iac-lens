import { useCallback, useState } from "react";
import type { DragEvent } from "react";
import type { GraphEnvelope } from "../envelope.js";
import { EnvelopeError, parseEnvelope } from "./parse-envelope.js";
import { GraphView } from "./GraphView.js";

export function App() {
  const [envelope, setEnvelope] = useState<GraphEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (file: File) => {
    try {
      const parsed = parseEnvelope(JSON.parse(await file.text()));
      setEnvelope(parsed);
      setError(null);
    } catch (e) {
      setEnvelope(null);
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
            {envelope.graph.edges.length} edges
          </span>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

      {envelope ? (
        <GraphView graph={envelope.graph} />
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
