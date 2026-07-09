import type {
  HookMetadata,
  HooksListEntry,
  HooksListParams,
  HooksListResponse,
} from "@nodex/codex-app-server-protocol/v2";

export type CodexHookMetadata = HookMetadata;
export type CodexHooksListEntry = HooksListEntry;
export type CodexHooksListParams = HooksListParams;
export type CodexHooksListResponse = HooksListResponse;

export interface CodexHooksListInput {
  hostId: string;
  cwds: string[];
}

interface CodexHookStatePatchBase {
  key: string;
}

export type CodexHookStatePatch =
  | (CodexHookStatePatchBase & {
      enabled: boolean;
      trustedHash?: string;
    })
  | (CodexHookStatePatchBase & {
      enabled?: boolean;
      trustedHash: string;
    });

export interface CodexHooksStateUpdateInput {
  hostId: string;
  patches: CodexHookStatePatch[];
}

export interface CodexHooksChangedEvent {
  hostId: string;
}
