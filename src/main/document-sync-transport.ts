import type { DocumentSyncCommandResult } from "../shared/block-documents/document-sync";

export interface DocumentSyncClientTarget {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: "destroyed", listener: () => void): unknown;
  removeListener(event: "destroyed", listener: () => void): unknown;
}

export const documentSyncUnauthorized = <Value>(): DocumentSyncCommandResult<Value> => ({
  ok: false,
  error: {
    code: "unauthorized",
    message: "Document sync is restricted to the subscribed application window",
    retryable: false,
    resetRequired: false,
  },
});
