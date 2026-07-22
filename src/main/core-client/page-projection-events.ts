import {
  PAGE_TARGET_CHANGE_EVENT_VERSION,
  type PageTargetChangedEvent,
} from "../../shared/page-target-events";
import type { CoreEventEnvelope } from "./types";

const projectionEvents = (
  envelope: CoreEventEnvelope,
  libraryId: string,
  pageIds: readonly string[],
  databaseIds: readonly string[],
  dataSourceIds: readonly string[],
): PageTargetChangedEvent[] => pageIds.map((pageId) => ({
  version: PAGE_TARGET_CHANGE_EVENT_VERSION,
  libraryId,
  storeEpoch: envelope.event.store_epoch,
  changeLogSeq: envelope.event.sequence,
  targetPageId: pageId,
  changeKind: "content",
  affectedDatabaseIds: databaseIds,
  affectedDataSourceIds: dataSourceIds,
}));

/** Maps every Core event that committed a Page-facing projection effect. */
export const mapCorePageProjectionEvents = (
  envelope: CoreEventEnvelope,
  libraryId: string,
): PageTargetChangedEvent[] => {
  const payload = envelope.event.payload;
  if (payload.module === "library") {
    return projectionEvents(
      envelope,
      libraryId,
      payload.event.page_ids,
      payload.event.database_ids,
      [],
    );
  }
  if (payload.module === "database") {
    return projectionEvents(
      envelope,
      libraryId,
      payload.event.page_ids,
      payload.event.database_ids,
      payload.event.data_source_ids,
    );
  }
  if (payload.module === "automation") {
    return projectionEvents(
      envelope,
      libraryId,
      payload.event.page_ids,
      payload.event.database_ids,
      [],
    );
  }
  if (payload.module !== "owned_document") return [];
  if (payload.event.kind === "canvas_updated") return [];
  const pageImpact = payload.event.page_impact;
  if (!pageImpact) return [];

  const database = pageImpact.database;
  const [event] = projectionEvents(
    envelope,
    pageImpact.library_id,
    [pageImpact.page_id],
    database ? [database.database_id] : [],
    database ? [database.data_source_id] : [],
  );
  if (!event || payload.event.kind !== "document_updated") {
    return event ? [event] : [];
  }
  return [{
    ...event,
    document: {
      id: payload.event.document_id,
      generation: payload.event.generation,
      headSeq: payload.event.head_seq,
    },
  }];
};
