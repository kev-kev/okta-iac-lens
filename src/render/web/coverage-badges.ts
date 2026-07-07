/**
 * web/coverage-badges: project a CoverageReport onto the viewer's drawn elements. PURE.
 *
 * The report's items carry a `(kind, key)` identity; this maps each to the thing that renders it:
 *  - Group / App / GroupRule  -> a node card (keyed by node id)
 *  - AppGroupAssignment       -> a `grants` EDGE (keyed by the React Flow edge id)
 *  - GlobalSessionPolicy / AppAuthPolicy -> a policy BADGE on a card (keyed by policy id)
 * Stale items reference state resources with no live node/edge, so they simply don't match
 * anything on the canvas (stale is panel-only, by design).
 */

import type { CoverageBucket, SlimCoverageReport } from "../../analysis/coverage.js";

export interface CoverageBadges {
  /** node id -> bucket, for Group/App/GroupRule cards. */
  bucketByNodeId: Map<string, CoverageBucket>;
  /** React Flow grants-edge id (`grants:<groupId>:<appId>`) -> bucket, for assignments. */
  bucketByEdgeId: Map<string, CoverageBucket>;
  /** policy id -> bucket, for the session/auth policy badges. */
  bucketByPolicyId: Map<string, CoverageBucket>;
}

export function coverageBadges(report: SlimCoverageReport): CoverageBadges {
  const bucketByNodeId = new Map<string, CoverageBucket>();
  const bucketByEdgeId = new Map<string, CoverageBucket>();
  const bucketByPolicyId = new Map<string, CoverageBucket>();

  for (const item of report.items) {
    switch (item.kind) {
      case "AppGroupAssignment": {
        // item.key is `${appId}/${groupId}`; the grants edge runs group -> app.
        const slash = item.key.indexOf("/");
        const appId = item.key.slice(0, slash);
        const groupId = item.key.slice(slash + 1);
        bucketByEdgeId.set(`grants:${groupId}:${appId}`, item.bucket);
        break;
      }
      case "GlobalSessionPolicy":
      case "AppAuthPolicy":
        bucketByPolicyId.set(item.key, item.bucket);
        break;
      default:
        bucketByNodeId.set(item.key, item.bucket);
    }
  }

  return { bucketByNodeId, bucketByEdgeId, bucketByPolicyId };
}
