import { useCallback, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { NodeKind } from "../../core/model.js";
import { trace } from "../../core/access-paths.js";
import type { TraceResult } from "../../core/access-paths.js";
import { EnvelopeError, parseEnvelope } from "./parse-envelope.js";
import type { ParsedEnvelope } from "./parse-envelope.js";
import { deriveCards } from "./derive-cards.js";
import { coverageBadges } from "./coverage-badges.js";
import { highlightForPolicy, highlightForTrace } from "./highlight.js";
import { buildIndexes } from "./indexes.js";
import {
  AUTO_THRESHOLD,
  buildFocusView,
  hiddenNeighbors,
  MAX_PER_SIDE,
  MIN_PER_SIDE,
} from "./build-focus-view.js";
import { HiddenNeighborsPanel } from "./HiddenNeighborsPanel.js";
import { FocusDetailPanel } from "./FocusDetailPanel.js";
import { GraphView } from "./GraphView.js";
import { TracePanel } from "./TracePanel.js";
import { PolicyPanel } from "./PolicyPanel.js";
import { CoveragePanel } from "./CoveragePanel.js";
import { Explorer } from "./Explorer.js";
import { buildCohorts } from "./cohorts.js";
import { OverviewCanvas } from "./OverviewCanvas.js";
import { CohortList } from "./CohortList.js";
import { VirtualList } from "./VirtualList.js";

type Selection = { kind: "group"; id: string } | { kind: "policy"; id: string } | null;

export function App() {
  const [envelope, setEnvelope] = useState<ParsedEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusId, setFocusIdRaw] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<{ hostId: string; kind: NodeKind } | null>(null);
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const [query, setQuery] = useState("");
  const [showLabels, setShowLabels] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);

  /** Changing focus always closes the hidden-neighbors panel. */
  const setFocusId = useCallback((id: string | null) => {
    setFocusIdRaw(id);
    setExpanded(null);
  }, []);

  const load = useCallback(async (file: File) => {
    try {
      const parsed = parseEnvelope(JSON.parse(await file.text()));
      setEnvelope(parsed);
      setSelection(null);
      setFocusId(null);
      setCohortId(null);
      setBrowseAll(false);
      setQuery("");
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

  // Viewport-adaptive per-side neighbor cap: how many cards fit the canvas height, clamped.
  const perSideCap = useMemo(() => {
    const rowPx = 96; // ~card height + gap
    const fit = Math.floor((window.innerHeight - 160) / rowPx);
    return Math.max(MIN_PER_SIDE, Math.min(MAX_PER_SIDE, fit));
  }, []);

  const focus = useMemo(() => {
    if (!graph || !indexes || !isLarge || !focusId) return null;
    return buildFocusView(graph, indexes, [focusId], {
      perSideCap,
      bucketByNodeId: badges?.bucketByNodeId,
    });
  }, [graph, indexes, isLarge, focusId, perSideCap, badges]);
  const focusCards = useMemo(() => (focus ? deriveCards(focus.graph) : null), [focus]);

  // Aggregated landing model + search results (large tenants only).
  const cohortModel = useMemo(
    () => (graph && cards && isLarge ? buildCohorts(graph, cards) : null),
    [graph, cards, isLarge],
  );
  const activeCohort = useMemo(
    () => cohortModel?.cohorts.find((c) => c.id === cohortId) ?? null,
    [cohortModel, cohortId],
  );
  const searchResults = useMemo(() => {
    if (!indexes || query.trim().length < 2) return null;
    return indexes.search(query, 200);
  }, [indexes, query]);

  /** What the clicked "+N more <kind>" stands for, as nodes (for the panel list). */
  const expandedNeighbors = useMemo(() => {
    if (!focus || !indexes || !expanded) return null;
    return hiddenNeighbors(focus, indexes, expanded.hostId, expanded.kind)
      .map((id) => indexes.nodeById.get(id))
      .filter((n): n is NonNullable<typeof n> => n != null);
  }, [focus, indexes, expanded]);

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
                ? " · large tenant"
                : " · click a group to trace, or a policy badge to see its reach"}
            </span>
            {isLarge && (
              <input
                className="header-search"
                placeholder="Search all resources…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
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
        searchResults ? (
          <div className="explorer-main">
            <div className="focus-bar">
              <button type="button" className="clear-btn" onClick={() => setQuery("")}>
                ← Overview
              </button>
              <span className="meta">
                {searchResults.length} match{searchResults.length === 1 ? "" : "es"} for “{query}”
              </span>
            </div>
            <VirtualList
              items={searchResults}
              rowHeight={40}
              height={560}
              keyOf={(n) => n.id}
              renderRow={(n) => (
                <button
                  type="button"
                  className="explorer-row"
                  onClick={() => {
                    setQuery("");
                    setFocusId(n.id);
                  }}
                >
                  <span className="row-name">{n.name}</span>
                  <span className="row-meta">{n.kind}</span>
                </button>
              )}
            />
          </div>
        ) : focus && focusCards ? (
          <div className="focus-view">
            <div className="focus-bar">
              <button type="button" className="clear-btn" onClick={() => setFocusId(null)}>
                ← Overview
              </button>
              <span className="meta">
                Focused on <strong>{nameById.get(focusId ?? "") ?? focusId}</strong>
                {focus.truncated ? " · showing direct connections; use “+N more” for the rest" : ""}
              </span>
            </div>
            <div className="workspace">
              <GraphView
                cards={focusCards}
                badges={badges}
                aggregates={focus.aggregates}
                focusNodeId={focusId}
                showLabels={showLabels}
                onFocusNode={(id) => setFocusId(id)}
                onDefocus={() => setFocusId(null)}
                onExpandAggregate={(hostId, kind) => setExpanded({ hostId, kind })}
                onClear={() => setExpanded(null)}
              />
              {expanded && expandedNeighbors ? (
                <HiddenNeighborsPanel
                  hostName={nameById.get(expanded.hostId) ?? expanded.hostId}
                  neighbors={expandedNeighbors}
                  onFocus={setFocusId}
                  onClear={() => setExpanded(null)}
                />
              ) : (
                focusId && (
                  <FocusDetailPanel
                    graph={graph}
                    focusId={focusId}
                    bucketByNodeId={badges?.bucketByNodeId}
                    onFocus={setFocusId}
                  />
                )
              )}
            </div>
          </div>
        ) : activeCohort && indexes ? (
          <CohortList
            label={activeCohort.label}
            memberIds={activeCohort.memberIds}
            indexes={indexes}
            onFocus={setFocusId}
            onBack={() => setCohortId(null)}
          />
        ) : browseAll && indexes ? (
          <div className="focus-view">
            <div className="focus-bar">
              <button type="button" className="clear-btn" onClick={() => setBrowseAll(false)}>
                ← Overview
              </button>
              <span className="meta">Browse all resources</span>
            </div>
            <Explorer graph={graph} indexes={indexes} coverage={coverage} onFocus={setFocusId} />
          </div>
        ) : cohortModel ? (
          <div className="explorer">
            <div className="explorer-main">
              <div className="overview-bar">
                <span className="meta">Your tenant at a glance — click a group to drill in</span>
                <button type="button" className="kind-tab" onClick={() => setBrowseAll(true)}>
                  Browse all resources
                </button>
              </div>
              <OverviewCanvas model={cohortModel} onSelectCohort={setCohortId} />
            </div>
            {coverage && <CoveragePanel report={coverage} />}
          </div>
        ) : null
      ) : cards ? (
        <div className="workspace">
          <GraphView
            cards={cards}
            highlight={highlight}
            selectedPolicyId={selectedPolicyId}
            badges={badges}
            showLabels={showLabels}
            onSelectGroup={(id) =>
              setSelection((cur) =>
                cur?.kind === "group" && cur.id === id ? null : { kind: "group", id },
              )
            }
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
