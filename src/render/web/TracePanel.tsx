import type { TraceResult } from "../../core/access-paths.js";

/**
 * Side panel mirroring the CLI's `trace` output for the selected group: granted apps with
 * their app-auth policy (or "org default app policy" when none), and the global session
 * policy. The two policy layers stay labelled as distinct things, same as everywhere else.
 */
export function TracePanel({ result, onClear }: { result: TraceResult; onClear: () => void }) {
  const gsp = result.globalSessionPolicy;
  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className="trace-kind">Group</div>
          <h2>{result.group.name}</h2>
        </div>
        <button type="button" className="clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>

      <h3>App access ({result.apps.length})</h3>
      {result.apps.length === 0 ? (
        <p className="muted">No apps granted.</p>
      ) : (
        <ul className="trace-apps">
          {result.apps.map((app) => {
            const policy = result.appAuthPolicies[app.id];
            return (
              <li key={app.id}>
                <span className="app-name">{app.name}</span>
                <span className={`app-policy${policy ? "" : " is-default"}`}>
                  {policy ? policy.name : "org default app policy"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <h3>Global session policy</h3>
      <p className={gsp ? "policy-value" : "muted"}>{gsp ? gsp.name : "(none)"}</p>
      <p className="panel-note">
        Real access is gated by <em>both</em> layers: the global session policy (sign-in to
        Okta) and each app's auth policy.
      </p>
    </aside>
  );
}
