/**
 * Side panel for a selected policy badge — the "sharing" / details-on-demand view. Shows which
 * resources the policy governs (the sharing you lose by putting policies on cards, recovered on
 * click). Kept distinct per layer: a session policy applies to groups, an auth policy protects
 * apps — never conflated.
 *
 * M15 Phase D: for an APP-auth policy it also surfaces the captured STRENGTH FLOOR — the weakest
 * documented way in + the deciding rule (`floor`, from the shared `formatPolicyFloor`). Session
 * policies show none (session-rule strength is M15-deferred). `bandKnown` distinguishes an unread
 * band (a muted note — never a fabricated verdict) from no resolver at all (a pre-M15 export → nothing).
 */
export function PolicyPanel({
  name,
  layer,
  governed,
  floor,
  bandKnown,
  onClear,
}: {
  name: string;
  layer: "session" | "auth";
  governed: { id: string; name: string }[];
  /** The formatted strength floor line, or null (unknown band / session layer / no resolver). */
  floor?: string | null;
  /** true = a band was read; false = resolver present but no rules classify it; null = no resolver. */
  bandKnown?: boolean | null;
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

      {layer === "auth" && bandKnown !== null && (
        <div className="policy-strength">
          <h3>Strength floor</h3>
          {floor ? (
            <p className="strength-floor">{floor}</p>
          ) : (
            <p className="muted">
              No captured rules classify this policy's strength — its band is unknown (its rules
              aren't in this export). Treated as a prior, not a proven weakness.
            </p>
          )}
          <p className="panel-note">
            The floor is the weakest way in any active ALLOW rule permits — a policy property, not
            proof every user reaches an app at that band (a scoped bypass is noted in the citation).
          </p>
        </div>
      )}

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
