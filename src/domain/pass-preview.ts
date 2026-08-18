/**
 * The pure Pass preview.
 *
 * The cascade-confirmation UI consumes this result rather than recreating the
 * cascade rule. It delegates to the one shared selection implementation, so the
 * preview and the command cannot diverge by construction rather than by
 * agreement.
 *
 * A preview grants no authority to mutate: the command still revalidates
 * against its expected snapshot version, so a preview taken against stale state
 * cannot be applied.
 *
 * Governed by `docs/tracker-behavior.md` §Domain implementation direction.
 */

import { selectPassCascade, type PassCascadeSelection } from "./pass-cascade";
import type { TrackerSnapshot } from "./tracker";

/**
 * Returns the exact ordered set of fixes a Pass command would mark passed,
 * without changing anything.
 */
export function previewPass(
  snapshot: TrackerSnapshot,
  routeIndex: number,
): PassCascadeSelection {
  return selectPassCascade(snapshot, routeIndex);
}
