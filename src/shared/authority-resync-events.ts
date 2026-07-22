export const AUTHORITY_RESYNC_EVENT_VERSION = 1 as const;

export interface AuthorityResyncEvent {
  readonly version: typeof AUTHORITY_RESYNC_EVENT_VERSION;
  readonly reason: "event_gap" | "transport_reconnected";
  readonly storeEpoch: string | null;
  readonly changeLogSeq: number | null;
}
