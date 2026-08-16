import type { EffectiveDatabaseViewPresentation } from "../../shared/database-kernel";
import {
  getDefaultDbViewPrefs,
  type DbViewDisplayPropertyKey,
  type DbViewPrefs,
} from "./db-view-prefs";

const CLASSIC_BOARD_PROPERTY_IDS = new Set<DbViewDisplayPropertyKey>([
  "status",
  "priority",
  "estimate",
  "tags",
  "assignee",
]);

export interface ClassicBoardPresentation {
  readonly prefs: DbViewPrefs;
  readonly identity: {
    readonly showPageKey: boolean;
    readonly showDescription: boolean;
  };
}

export const classicBoardPresentation = (
  effective: EffectiveDatabaseViewPresentation,
): ClassicBoardPresentation | null => {
  if (effective.presentation.group?.propertyId !== "status") return null;
  if (effective.presentation.subgroup !== null) return null;
  const fieldIds: DbViewDisplayPropertyKey[] = [];
  let showPageKey = false;
  for (const field of effective.presentation.layouts.board.fields) {
    if (field.kind === "intrinsic") {
      if (field.field !== "page_key") return null;
      showPageKey = true;
      continue;
    }
    if (
      !CLASSIC_BOARD_PROPERTY_IDS.has(
        field.propertyId as DbViewDisplayPropertyKey,
      )
    ) return null;
    const propertyId = field.propertyId as DbViewDisplayPropertyKey;
    if (propertyId !== "status") fieldIds.push(propertyId);
  }
  const defaults = getDefaultDbViewPrefs("board");
  const displayable = [...CLASSIC_BOARD_PROPERTY_IDS].filter(
    (propertyId) => propertyId !== "status",
  );
  return {
    identity: {
      showPageKey,
      showDescription: effective.presentation.layouts.board.showDescription !== false,
    },
    prefs: {
      ...defaults,
      display: {
        ...defaults.display,
        propertyOrder: fieldIds,
        hiddenProperties: displayable.filter(
          (propertyId) => !fieldIds.includes(propertyId),
        ),
      },
    },
  };
};
