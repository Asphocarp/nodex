import type {
  PageInput,
  PageUpdateMutationResult,
} from "./types";

export interface PageStageHandlers {
  onUpdate: (
    columnId: string,
    pageId: string,
    updates: Partial<PageInput>,
  ) => Promise<PageUpdateMutationResult | void>;
  onPatch: (
    columnId: string,
    pageId: string,
    updates: Partial<PageInput>,
  ) => void;
  onDelete: (columnId: string, pageId: string) => Promise<void>;
  onMove: (
    fromStatus: string,
    pageId: string,
    toStatus: string,
  ) => Promise<void>;
  onCompleteOccurrence?: (
    pageId: string,
    occurrenceStart: Date,
  ) => Promise<void>;
  onSkipOccurrence?: (
    pageId: string,
    occurrenceStart: Date,
  ) => Promise<void>;
}
