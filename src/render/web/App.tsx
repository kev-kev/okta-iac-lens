import { useCallback, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { trace } from "../../core/access-paths.js";
import type { TraceResult } from "../../core/access-paths.js";
import { EnvelopeError, parseEnvelope } from "./parse-envelope.js";
import type { ParsedEnvelope } from "./parse-envelope.js";
import { deriveCards } from "./derive-cards.js";
import { coverageBadges } from "./coverage-badges.js";
import { highlightForPolicy, highlightForTrace } from "./highlight.js";
import { GraphView } from "./GraphView.js";
import { TracePanel } from "./TracePanel.js";
import { PolicyPanel } from "./PolicyPanel.js";
import { CoveragePanel } from "./CoveragePanel.js";

type Selection = { kind: "group"; id: string } | { kind: "policy"; id: string } | null;

export function App() {
  const [envelope, setEnvelope] = useState<ParsedEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);

  const load = useCallback(async (file: File) => {
    try {
      const parsed = parseEnvelope(JSON.parse(await file.text()));
      setEnvelope(parsed);
      setSelection(null);
      setError(null);
    } catch (e) {
      setEnvelope(null);
      setSelection(null);
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
  const cards = useMemo(() => (graph ? deriveCards(graph) : null), [graph]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph?.nodes ?? []) m.set(n.id, n.name);
    return m;
  }, [graph]);

  const traceResult = useMemo<TraceResult | null>(() => {
    if (!graph || selection?.kind !== "group") return null;
    try {
      return trace(graph, selection.id);
    } catch {
      return null;
    }
  }, [graph, selection]);

  const selectedPolicy = useMemo(() => {
    if (!graph || !cards || selection?.kind !== "policy") return null;
    const node = graph.nodes.find((n) => n.id === selection.id);
    const layer =
      node?.kind === "GlobalSessionPolicy"
        ? "session"
        : node?.kind === "AppAuthPolicy"
          ? "auth"
          : null;
    if (!node || !layer) return null;
    const governed = (cards.resourcesByPolicy.get(node.id) ?? []).map((rid) => ({
      id: rid,
      name: nameById.get(rid) ?? rid,
    }));
    return { name: node.name, layer, governed } as const;
  }, [graph, cards, selection, nameById]);

  const highlight = useMemo(() => {
    if (!cards) return null;
    if (selection?.kind === "group" && traceResult) return highlightForTrace(traceResult);
    if (selection?.kind === "policy") return highlightForPolicy(cards, selection.id);
    return null;
  }, [cards, selection, traceResult]);

  const selectedPolicyId = selection?.kind === "policy" ? selection.id : null;

  const coverage = envelope?.coverage ?? null;
  const badges = useMemo(
    () => (coverage && showOverlay ? coverageBadges(coverage) : null),
    [coverage, showOverlay],
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
          <>
            <span className="meta">
              source: {envelope.source} · {envelope.graph.nodes.length} nodes · click a group to
              trace, or a policy badge to see its reach
            </span>
            {coverage && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showOverlay}
                  onChange={(e) => setShowOverlay(e.target.checked)}
                />
                Coverage overlay
              </label>
            )}
            <label className="toggle">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
              Edge labels
            </label>
          </>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {envelope?.notice && <div className="notice-banner">{envelope.notice}</div>}

      {cards ? (
        <div className="workspace">
          <GraphView
            cards={cards}
            highlight={highlight}
            selectedPolicyId={selectedPolicyId}
            badges={badges}
            showLabels={showLabels}
            onSelectGroup={(id) => setSelection({ kind: "group", id })}
            onSelectPolicy={(id) => setSelection({ kind: "policy", id })}
            onClear={() => setSelection(null)}
          />
          {selection?.kind === "group" && traceResult && (
            <TracePanel result={traceResult} onClear={() => setSelection(null)} />
          )}
          {selection?.kind === "policy" && selectedPolicy && (
            <PolicyPanel
              name={selectedPolicy.name}
              layer={selectedPolicy.layer}
              governed={selectedPolicy.governed}
              onClear={() => setSelection(null)}
            />
          )}
          {selection === null && coverage && showOverlay && <CoveragePanel report={coverage} />}
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
