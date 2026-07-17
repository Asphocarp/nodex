import type Database from "better-sqlite3";
import { parseInlineMarkdownTitle, InlineMarkdownTitleError } from "../../shared/nfm/agent-title";
import type {
  CompleteNodexAgentPageUpdateRequest,
  CompleteNodexAgentPageUpdateResult,
  EditDocumentInput,
  EditDocumentOutput,
  PrepareNodexAgentPageUpdateRequest,
  PrepareNodexAgentPageUpdateResult,
} from "../../shared/nodex-agent-tools";
import { UpdatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import { requirePageStorageContext } from "./page-adapter";
import {
  completeNodexAgentDocumentEdit,
  prepareNodexAgentDocumentEditWithResolver,
} from "./document-edit-service";
import { NodexAgentReadError, readFailure } from "./read-support";
import { publicV3Failure } from "./v3-errors";

function parseTitle(markdown: string) {
  try {
    return parseInlineMarkdownTitle(markdown);
  } catch (error) {
    if (!(error instanceof InlineMarkdownTitleError)) throw error;
    throw new NodexAgentReadError(
      "invalid_arguments",
      error.message,
      false,
      "none",
      { domainCode: "invalid_inline_markdown_title" },
    );
  }
}

function returnOptions(selectors: readonly string[] | undefined): EditDocumentInput["return"] {
  if (!selectors) return undefined;
  return {
    ...(selectors.includes("markdown") ? { nfm: true } : {}),
    ...(selectors.includes("block_ids") ? { blockIds: true } : {}),
    ...(selectors.includes("etags") ? { etags: true } : {}),
  };
}

function normalizeUpdate(
  request: PrepareNodexAgentPageUpdateRequest,
  documentId: EditDocumentInput["documentId"],
): EditDocumentInput {
  if (request.tool === "advanced_update_page") {
    const projectedReturn = returnOptions(request.input.return);
    return {
      documentId,
      body: { kind: "blocks", edits: request.input.edits },
      ...(request.input.safety ? { safety: request.input.safety } : {}),
      ...(projectedReturn ? { return: projectedReturn } : {}),
    };
  }

  const body: EditDocumentInput["body"] = request.input.body?.kind === "insert"
    ? {
        kind: "nfm.insert",
        at: request.input.body.at,
        content: request.input.body.markdown,
      }
    : request.input.body?.kind === "patch"
      ? {
          kind: "nfm.patch",
          patches: request.input.body.patches.map((patch) => ({
            oldNfm: patch.oldMarkdown,
            newNfm: patch.newMarkdown,
            ...(patch.expectedMatches !== undefined
              ? { expectedMatches: patch.expectedMatches }
              : {}),
          })),
        }
      : request.input.body?.kind === "replace"
        ? {
            kind: "nfm.replace",
            content: request.input.body.markdown,
            ifMatch: request.input.body.ifMatch,
          }
        : undefined;
  const projectedReturn = returnOptions(request.input.return);
  return {
    documentId,
    ...(request.input.title
      ? {
          title: {
            value: {
              kind: "rich",
              richText: [...parseTitle(request.input.title.markdown)],
            },
            ifMatch: request.input.title.ifMatch,
          },
        }
      : {}),
    ...(body ? { body } : {}),
    ...(request.input.safety ? { safety: request.input.safety } : {}),
    ...(projectedReturn ? { return: projectedReturn } : {}),
  };
}

function publicOutput(pageId: string, output: EditDocumentOutput) {
  return UpdatePageV3OutputSchema.parse({
    data: {
      pageId,
      effects: output.data.effects,
      ...(output.data.body
        ? {
            body: {
              format: "markdown",
              markdown: output.data.body.content,
              contentHash: output.data.body.contentHash,
            },
          }
        : {}),
      ...(output.data.etags ? { etags: output.data.etags } : {}),
    },
  });
}

export function prepareNodexAgentPageUpdate(
  database: Database.Database,
  request: PrepareNodexAgentPageUpdateRequest,
): PrepareNodexAgentPageUpdateResult {
  try {
    return database.transaction(() => {
      const { input, ...identity } = request;
      const page = requirePageStorageContext(
        database,
        request.projectId,
        request.input.pageId,
        "write",
        request.authority,
      );
      const result = prepareNodexAgentDocumentEditWithResolver(
        database,
        { ...identity, projectId: page.contentProjectId },
        input,
        () => normalizeUpdate(request, page.documentId),
      );
      if (!result.ok) return { ok: false as const, error: publicV3Failure(result.error) };
      if (result.value.kind === "completed") {
        return {
          ok: true as const,
          value: {
            kind: "completed" as const,
            output: publicOutput(request.input.pageId, result.value.output),
          },
        };
      }
      return {
        ok: true as const,
        value: {
          kind: "prepared" as const,
          mutation: result.value.mutation,
          effects: result.value.effects,
          targetMarkdown: result.value.targetNfm,
        },
      };
    }).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function completeNodexAgentPageUpdate(
  database: Database.Database,
  request: CompleteNodexAgentPageUpdateRequest,
): CompleteNodexAgentPageUpdateResult {
  let page;
  try {
    page = requirePageStorageContext(
      database,
      request.projectId,
      request.pageId,
      "write",
      request.authority,
    );
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
  const result = completeNodexAgentDocumentEdit(database, {
    ...request,
    projectId: page.contentProjectId,
  });
  if (!result.ok) return { ok: false, error: publicV3Failure(result.error) };
  return { ok: true, output: publicOutput(request.pageId, result.output) };
}
