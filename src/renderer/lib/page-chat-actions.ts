import type { CodexPromptInput } from "@/lib/types";

export type ChatDestinationTarget =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "new-thread"; readonly sessionId?: string };

export interface OpenPageInNewChatInput {
  readonly projectId: string;
  readonly pageId: string;
  readonly titleSnapshot?: string;
}

export interface SendPageToChatInput extends OpenPageInNewChatInput {
  readonly target: ChatDestinationTarget;
}

export interface PagePromptContext {
  readonly pageId: string;
  readonly projectId: string;
  readonly title: string;
  readonly source: string;
  readonly promptInput: CodexPromptInput;
}
