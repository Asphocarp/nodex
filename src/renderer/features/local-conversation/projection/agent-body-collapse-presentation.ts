import type { ThreadAgentRenderUnit } from "../thread-stage-types";

export interface ThreadAgentBodyCollapsePresentation {
  collapsibleUnits: ThreadAgentRenderUnit[];
  expandedUnits: readonly ThreadAgentRenderUnit[];
  persistentUnits: ThreadAgentRenderUnit[];
}

function isCollapsePersistentUnit(unit: ThreadAgentRenderUnit): boolean {
  if (unit.kind !== "entry" || unit.block.type !== "userMessage") return false;

  const steeringStatus = unit.block.entry.steeringStatus;
  return (steeringStatus !== undefined && steeringStatus !== null)
    || unit.block.entry.hookFeedback === true;
}

/**
 * Keeps steering and hook-feedback messages visible while historical agent
 * activity is collapsed. Expanded presentation preserves the canonical unit
 * order instead of maintaining a second transcript ordering model.
 */
export function projectAgentBodyCollapsePresentation(
  units: readonly ThreadAgentRenderUnit[],
): ThreadAgentBodyCollapsePresentation {
  const collapsibleUnits: ThreadAgentRenderUnit[] = [];
  const persistentUnits: ThreadAgentRenderUnit[] = [];

  for (const unit of units) {
    if (isCollapsePersistentUnit(unit)) {
      persistentUnits.push(unit);
      continue;
    }

    collapsibleUnits.push(unit);
  }

  return {
    collapsibleUnits,
    expandedUnits: units,
    persistentUnits,
  };
}

export function countAgentBodyUnits(units: readonly ThreadAgentRenderUnit[]): number {
  return units.reduce(
    (count, unit) => count + (unit.kind === "agentActivityGroup" ? unit.block.entries.length : 1),
    0,
  );
}
