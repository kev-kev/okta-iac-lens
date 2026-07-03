/**
 * Side panel for a selected policy badge — the "sharing" / details-on-demand view. Shows which
 * resources the policy governs (the sharing you lose by putting policies on cards, recovered on
 * click). Kept distinct per layer: a session policy applies to groups, an auth policy protects
 * apps — never conflated.
 */
export function PolicyPanel({
  name,
  layer,
  governed,
  onClear,
}: {
  name: string;
  layer: "session" | "auth";
  governed: { id: string; name: string }[];
  onClear: () => void;
}) {
  const layerLabel = layer === "session" ? "Global session policy" : "App auth policy";
  const governedLabel = layer === "session" ? "Groups it applies to" : "Apps it protects";
  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className={`trace-kind badge-${layer}-text`}>{layerLabel}</div>
          <h2>{name}</h2>
        </div>
        <button type="button" className="clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>

      <h3>
        {governedLabel} ({governed.length})
      </h3>
      {governed.length === 0 ? (
        <p className="muted">Nothing references this policy.</p>
      ) : (
        <ul className="trace-apps">
          {governed.map((r) => (
            <li key={r.id}>
              <span className="app-name">{r.name}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="panel-note">Highlighted on the canvas: every card this policy governs.</p>
    </aside>
  );
}
