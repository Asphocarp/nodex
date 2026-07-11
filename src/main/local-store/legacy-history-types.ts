import type { Card } from "../../shared/types";

/**
 * Compatibility-only shapes for the pre-Block Card history tables. They stay
 * beside the migration/reconstruction store and must not re-enter IPC or HTTP
 * contracts.
 */
export interface LegacyHistoryEntry {
  id: number;
  projectId: string;
  operation: "create" | "update" | "delete" | "move";
  cardId: string;
  status: Card["status"];
  archived: boolean;
  timestamp: string;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  fromStatus: Card["status"] | null;
  toStatus: Card["status"] | null;
  fromArchived: boolean | null;
  toArchived: boolean | null;
  fromOrder: number | null;
  toOrder: number | null;
  cardSnapshot: Card | null;
  sessionId: string | null;
  groupId: string | null;
  isUndone: boolean;
  undoOf: number | null;
}

export interface LegacyHistoryPanelFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface LegacyHistoryPanelSnapshotField {
  field: string;
  value: unknown;
}

export interface LegacyHistoryPanelDescriptionDeltaBlock {
  changeType: "added" | "removed" | "replaced";
  blockType: string;
  beforeOrdinal: number | null;
  afterOrdinal: number | null;
  beforePreview: string | null;
  afterPreview: string | null;
  beforeNfm: string | null;
  afterNfm: string | null;
}

export interface LegacyHistoryPanelDescriptionSnapshotBlock {
  ordinal: number;
  blockType: string;
  preview: string;
  nfm: string;
}

export interface LegacyHistoryPanelDescriptionDelta {
  beforeBlockCount: number;
  afterBlockCount: number;
  beforeFullText: string | null;
  afterFullText: string | null;
  blocks: LegacyHistoryPanelDescriptionDeltaBlock[];
}

export interface LegacyHistoryPanelDescriptionSnapshot {
  blockCount: number;
  blocks: LegacyHistoryPanelDescriptionSnapshotBlock[];
}

export interface LegacyHistoryPanelSnapshot {
  fields: LegacyHistoryPanelSnapshotField[];
  description: LegacyHistoryPanelDescriptionSnapshot | null;
}

export interface LegacyHistoryPanelMove {
  fromStatus: Card["status"] | null;
  toStatus: Card["status"] | null;
  fromArchived: boolean | null;
  toArchived: boolean | null;
  fromOrder: number | null;
  toOrder: number | null;
}

export interface LegacyHistoryPanelEntry {
  id: number;
  projectId: string;
  operation: "create" | "update" | "delete" | "move";
  cardId: string;
  status: Card["status"];
  archived: boolean;
  timestamp: string;
  sessionId: string | null;
  groupId: string | null;
  isUndone: boolean;
  undoOf: number | null;
  summary: string | null;
  fieldChanges: LegacyHistoryPanelFieldChange[];
  move: LegacyHistoryPanelMove | null;
  descriptionChange: LegacyHistoryPanelDescriptionDelta | null;
  snapshot: LegacyHistoryPanelSnapshot | null;
  reconstructable: boolean;
  reconstructionUnavailableReason: string | null;
}

export interface LegacyHistoryCardVersionPreview {
  historyId: number;
  projectId: string;
  cardId: string;
  card: Card;
}
