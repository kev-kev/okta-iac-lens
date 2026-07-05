import { useCallback, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { trace } from "../../core/access-paths.js";
import type { TraceResult } from "../../core/access-paths.js";
import { EnvelopeError, parseEnvelope } from "./parse-envelope.js";
import type { ParsedEnvelope } from "./parse-envelope.js";
import { deriveCards } from "./derive-cards.js";
import { coverageBadges } from "./coverage-badges.js";
import { highlightForPolicy, highlightForTrace } from "./highlight.js";
import { buildIndexes } from "./indexes.js";
import { AUTO_THRESHOLD, buildFocusView, hiddenNeighbors } from "./build-focus-view.js";
import { HiddenNeighborsPanel } from "./HiddenNeighborsPanel.js";
import { GraphView } from "./GraphView.js";
import { TracePanel } from "./TracePanel.js";
import { PolicyPanel } from "./PolicyPanel.js";
import { CoveragePanel } from "./CoveragePanel.js";
import { Explorer } from "./Explorer.js";

type Selection = { kind: "group"; id: string } | { kind: "policy"; id: string } | null;

export function App() {
  const [envelope, setEnvelope] = useState<ParsedEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusId, setFocusIdRaw] = useState<string | null>(null);
  const [expandedHostId, setExpandedHostId] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);

  /** Changing focus always closes the hidden-neighbors panel. */
  const setFocusId = useCallback((id: string | null) => {
    setFocusIdRaw(id);
    setExpandedHostId(null);
  }, []);

  const load = useCallback(async (file: File) => {
    try {
      const parsed = parseEnvelope(JSON.parse(await file.text()));
      setEnvelope(parsed);
      setSelection(null);
      setFocusId(null);
      setError(null);
    } catch (e) {
      setEnvelope(null);
      setSelection(null);
      setFocusId(null);
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

  // Scale mode: above the threshold, land query-first and render bounded focus views.
  const isLarge = (graph?.nodes.length ?? 0) > AUTO_THRESHOLD;
  const indexes = useMemo(() => (graph ? buildIndexes(graph) : null), [graph]);

  const focus = useMemo(() => {
    if (!graph || !indexes || !isLarge || !focusId) return null;
    return buildFocusView(graph, indexes, [focusId], { bucketByNodeId: badges?.bucketByNodeId });
  }, [graph, indexes, isLarge, focusId, badges]);
  const focusCards = useMemo(() => (focus ? deriveCards(focus.graph) : null), [focus]);

  /** What the clicked "+N more" stands for, as nodes (for the panel list). */
  const expandedNeighbors = useMemo(() => {
    if (!focus || !indexes || !expandedHostId) return null;
    return hiddenNeighbors(focus, indexes, expandedHostId)
      .map((id) => indexes.nodeById.get(id))
      .filter((n): n is NonNullable<typeof n> => n != null);
  }, [focus, indexes, expandedHostId]);

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
              source: {envelope.source} · {envelope.graph.nodes.length} nodes
              {isLarge
                ? " · large tenant: search or pick a resource to focus"
                : " · click a group to trace, or a policy badge to see its reach"}
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

      {!graph ? (
        <div className="dropzone">
          <p>
            Drop a graph JSON here, or use <strong>Open graph…</strong>
          </p>
          <p className="hint">
            Generate one with <code>npm run dev -- export --state &lt;tfstate&gt;</code>
          </p>
        </div>
      ) : isLarge ? (
        focus && focusCards ? (
          <div className="focus-view">
            <div className="focus-bar">
              <button type="button" className="clear-btn" onClick={() => setFocusId(null)}>
                ← All resources
              </button>
              <span className="meta">
                Focused on <strong>{nameById.get(focusId ?? "") ?? focusId}</strong>
                {focus.truncated ? " · view truncated to stay legible" : ""}
              </span>
            </div>
            <div className="workspace">
              <GraphView
                cards={focusCards}
                badges={badges}
                aggregates={focus.aggregates}
                focusNodeId={focusId}
                viewKey={focusId ?? undefined}
                showLabels={showLabels}
                onFocusNode={(id) => setFocusId(id)}
                onExpandAggregate={(hostId) => setExpandedHostId(hostId)}
                onClear={() => setExpandedHostId(null)}
              />
              {expandedHostId && expandedNeighbors && (
                <HiddenNeighborsPanel
                  hostName={nameById.get(expandedHostId) ?? expandedHostId}
                  neighbors={expandedNeighbors}
                  onFocus={setFocusId}
                  onClear={() => setExpandedHostId(null)}
                />
              )}
            </div>
          </div>
        ) : (
          indexes && (
            <Explorer graph={graph} indexes={indexes} coverage={coverage} onFocus={setFocusId} />
          )
        )
      ) : cards ? (
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
      ) : null}
    </div>
  );
}
