import { useState } from "react";
import type { OktaGraph } from "../../core/model.js";
import { explainUserApp } from "../../core/access-paths.js";
import type { UserTraceResult } from "../../core/access-paths.js";

/**
 * The textual companion to the on-canvas user-access view — the full detail the CLI `trace --user`
 * prints: apps with their gate, per-group provenance (rule-populated vs direct), session gates.
 * Clicking an app expands the path(s) by which the user reaches it (via `explainUserApp`). Same
 * honesty rails as everywhere: provenance never claims the rule admitted this user; "org default"
 * ≠ unprotected.
 */
export function UserTracePanel({
  graph,
  result,
  onClear,
}: {
  graph: OktaGraph;
  result: UserTraceResult;
  onClear: () => void;
}) {
  const [openApp, setOpenApp] = useState<string | null>(null);

  return (
    <aside className="trace-panel">
      <div className="trace-head">
        <div>
          <div className="trace-kind">User</div>
          <h2>{result.user.login}</h2>
        </div>
        <button type="button" className="clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>

      <h3>Apps provisioned ({result.apps.length})</h3>
      {result.apps.length === 0 ? (
        <p className="muted">No apps via any group.</p>
      ) : (
        <ul className="trace-apps">
          {result.apps.map((app) => {
            const policy = result.appAuthPolicies[app.id];
            const open = openApp === app.id;
            const explain = open ? explainUserApp(graph, result, app.id) : null;
            return (
              <li key={app.id}>
                <button
                  type="button"
                  className="link-row app-row"
                  onClick={() => setOpenApp(open ? null : app.id)}
                >
                  <span className="app-name">{app.name}</span>
                  <span className={`app-policy${policy ? "" : " is-default"}`}>
                    {policy ? policy.name : "org default app policy"}
                  </span>
                </button>
                {explain && (
                  <ul className="via-list">
                    {explain.paths.map((p) => (
                      <li key={p.group.id} className="muted">
                        via {p.group.name}
                        {" · "}
                        {p.populatingRules.length > 0
                          ? `rule ${p.populatingRules.map((r) => r.name).join(", ")}`
                          : "direct"}
                        {" · session gate: "}
                        {p.globalSessionPolicy ? p.globalSessionPolicy.name : "(none)"}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3>Group memberships ({result.viaGroups.length})</h3>
      <ul className="trace-apps">
        {result.viaGroups.map((v) => (
          <li key={v.group.id}>
            <span className="app-name">{v.group.name}</span>
            <span className="app-policy is-default">
              {v.populatingRules.length > 0
                ? `rule ${v.populatingRules.map((r) => r.name).join(", ")}`
                : "direct"}
            </span>
          </li>
        ))}
      </ul>
      {result.unknownGroupIds.length > 0 && (
        <p className="muted">
          + {result.unknownGroupIds.length} membership group(s) outside the loaded tenant, not shown.
        </p>
      )}

      <p className="panel-note">
        “Provisioned to / gated by,” not “can access”: runtime policy conditions (MFA, device,
        network) are not evaluated here.
      </p>
    </aside>
  );
}
