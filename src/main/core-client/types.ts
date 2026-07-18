import type { components } from "@nodex/core-protocol";

export type CoreRuntimeDescriptor = components["schemas"]["RuntimeDescriptor"];
export type CoreHandshakeResponse = components["schemas"]["HandshakeResponse"];
export type CoreEventEnvelope = components["schemas"]["EventEnvelope"];
export type CoreModuleError = components["schemas"]["CoreError"];

export type LibraryReadRequest = components["schemas"]["LibraryReadRequest"];
export type LibraryRead = LibraryReadRequest["read"];
export type LibraryReadResponse = components["schemas"]["LibraryReadResponse"];
export type LibraryApplyRequest = components["schemas"]["LibraryApplyRequest"];
export type LibraryIntent = LibraryApplyRequest["intent"];
export type LibraryApplyResponse = components["schemas"]["LibraryApplyResponse"];

type SuccessfulPayload<Response> = Response extends {
  readonly status: "ok";
  readonly payload: infer Payload;
}
  ? Payload
  : never;

export type LibraryReadSnapshot = SuccessfulPayload<LibraryReadResponse>;
export type LibraryCommittedValue = SuccessfulPayload<LibraryApplyResponse>;

export interface LibraryApplyInput {
  readonly operationId: string;
  readonly intent: LibraryIntent;
}

export interface CoreEventSubscription {
  readonly done: Promise<void>;
  close(): void;
}

export interface CoreClientPort {
  libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot>;
  libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue>;
  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
  ): Promise<CoreEventSubscription>;
}
