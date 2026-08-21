import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import type {
  CodexConversationImageAssetResolveInput,
  CodexConversationImageAssetResolveResult,
} from "../../shared/types";
import { resolveChatGptBaseUrl } from "./chatgpt-base-url";
import type { ChatGptDesktopRequestInput } from "./chatgpt-desktop-request";

interface ConversationImageAssetDownloadResponse {
  download_url?: unknown;
  status?: unknown;
}

export interface CodexConversationImageAssetServiceDependencies {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  readConfig: () => Promise<ConfigReadResponse>;
  requestChatGptDesktop: (input: ChatGptDesktopRequestInput) => Promise<Response>;
}

function parsePointerFileId(pointer: string): string | null {
  const trimmed = pointer.trim();
  const match = /^(?:file-service|sediment):\/\/(.+)$/u.exec(trimmed);
  const fileId = match?.[1]?.trim() ?? "";
  return fileId.length > 0 ? fileId : null;
}

function failure(
  message: string,
  status: number | null = null,
): CodexConversationImageAssetResolveResult {
  return { ok: false, message, status };
}

async function readResponseMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim().length > 0 ? text.trim() : response.statusText || "Request failed";
}

export class CodexConversationImageAssetService {
  constructor(private readonly deps: CodexConversationImageAssetServiceDependencies) {}

  async resolve(
    input: CodexConversationImageAssetResolveInput,
  ): Promise<CodexConversationImageAssetResolveResult> {
    if (input.hostId !== DEFAULT_CODEX_HOST_ID) {
      return failure(`Unsupported Codex image asset host: ${input.hostId}`);
    }

    const fileId = parsePointerFileId(input.pointer);
    if (!fileId) return failure("Invalid Codex image asset pointer");

    try {
      const config = await this.deps.readConfig();
      const baseUrl = resolveChatGptBaseUrl(config);
      const linkResponse = await this.deps.requestChatGptDesktop({
        action: "resolve a generated image",
        baseUrl,
        path: `/files/download/${encodeURIComponent(fileId)}`,
        method: "GET",
        refreshOn401: true,
        missingAuthErrorMessage: "ChatGPT authentication is required to load this generated image.",
      });
      if (!linkResponse.ok) {
        return failure(await readResponseMessage(linkResponse), linkResponse.status);
      }

      const payload = (await linkResponse.json()) as ConversationImageAssetDownloadResponse;
      if (payload.status != null && payload.status !== "success") {
        return failure("Generated image download is not ready");
      }
      const downloadUrl =
        typeof payload.download_url === "string" ? payload.download_url.trim() : "";
      if (downloadUrl.length === 0) {
        return failure("Generated image download response is missing download_url");
      }

      const downloadResponse = await this.deps.fetchImpl(downloadUrl, {
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!downloadResponse.ok) {
        return failure(await readResponseMessage(downloadResponse), downloadResponse.status);
      }

      const bytes = Buffer.from(await downloadResponse.arrayBuffer());
      return {
        ok: true,
        dataBase64: bytes.toString("base64"),
        mimeType: downloadResponse.headers.get("content-type"),
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Could not load generated image");
    }
  }
}
