import type { CodexPromptInput } from "@/lib/types";
import { buildPageDeepLink } from "@/lib/page-deeplink";
import { parseNfm } from "@/lib/nfm";
import { materializePageDocument } from "../../shared/block-documents/block-document-codec";
import type { OwnedDocumentDescriptor } from "../../shared/block-documents/contracts";
import {
  createDocumentSyncAdapter,
  prepareOwnedBlockDocument,
} from "./api";
import {
  BlockDocumentSurfaceRuntime,
  type BlockDocumentSurfaceRuntimeOptions,
} from "./block-document-surface-runtime";
import {
  unwrapOwnedBlockDocumentPreparationResult,
} from "./owned-block-document";
import {
  buildCodexPromptInputFromNfmBlocks,
} from "./codex-prompt-input";
import type { PagePromptContext } from "./page-chat-actions";

export interface BuildPagePromptContextInput {
  readonly projectId: string;
  readonly pageId: string;
  readonly pageKey?: string;
  readonly title: string;
  readonly nfm: string;
  readonly source?: string;
}

export function buildPagePromptContext({
  projectId,
  pageId,
  pageKey,
  title,
  nfm,
  source = buildPageDeepLink({ pageId }),
}: BuildPagePromptContextInput): PagePromptContext {
  const normalizedTitle = title.trim() || "Untitled Page";
  const normalizedPageKey = pageKey?.trim() || undefined;
  const basePrompt = buildCodexPromptInputFromNfmBlocks(parseNfm(nfm));
  const promptText = [
    `Page: ${normalizedTitle}`,
    ...(normalizedPageKey ? [`Page key: ${normalizedPageKey}`] : []),
    `Source: ${source}`,
    "",
    basePrompt.text,
  ].join("\n").trim();
  const promptInput: CodexPromptInput = {
    ...basePrompt,
    text: promptText,
  };

  return {
    projectId,
    pageId,
    ...(normalizedPageKey ? { pageKey: normalizedPageKey } : {}),
    title: normalizedTitle,
    source,
    promptInput,
  };
}

export async function loadPagePromptContext(input: {
  readonly projectId: string;
  readonly pageId: string;
  readonly pageKey?: string;
  readonly titleSnapshot?: string;
  readonly createRuntime?: (
    options: BlockDocumentSurfaceRuntimeOptions,
  ) => BlockDocumentSurfaceRuntime;
}): Promise<PagePromptContext> {
  const descriptor = unwrapOwnedBlockDocumentPreparationResult(
    await prepareOwnedBlockDocument(input.projectId, input.pageId),
  );
  const runtimeFactory = input.createRuntime ?? ((options) =>
    new BlockDocumentSurfaceRuntime(options));
  const runtime = createPageDocumentRuntime(
    descriptor,
    input.projectId,
    runtimeFactory,
  );

  try {
    await runtime.connect();
    await runtime.whenReady();
    const materialized = materializePageDocument(runtime.document);
    return buildPagePromptContext({
      projectId: input.projectId,
      pageId: input.pageId,
      pageKey: input.pageKey,
      title: materialized.title.trim() || input.titleSnapshot || "Untitled Page",
      nfm: materialized.nfm,
    });
  } finally {
    await runtime.close();
  }
}

function createPageDocumentRuntime(
  descriptor: OwnedDocumentDescriptor,
  projectId: string,
  runtimeFactory: (
    options: BlockDocumentSurfaceRuntimeOptions,
  ) => BlockDocumentSurfaceRuntime,
): BlockDocumentSurfaceRuntime {
  return runtimeFactory({
    descriptor,
    adapter: createDocumentSyncAdapter(projectId),
    localCheckpointStore: null,
  });
}
