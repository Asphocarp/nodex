import { arch, platform } from "node:process";
import type { GetAuthStatusResponse } from "@nodex/codex-app-server-protocol";

export const CHATGPT_DESKTOP_ORIGINATOR = "Codex Desktop";
export type ChatGptDesktopRequestHeaders = Headers | Record<string, string> | Array<[string, string]>;
export type ChatGptDesktopRequestBody = string | ArrayBuffer | Uint8Array;

export interface ChatGptDesktopRequestDependencies {
  readAuthStatus: (input: { includeToken: boolean; refreshToken: boolean }) => Promise<GetAuthStatusResponse>;
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  getAppVersion: () => string;
}

export interface ChatGptDesktopRequestInput {
  method: string;
  baseUrl: string;
  path: string;
  headers?: ChatGptDesktopRequestHeaders;
  body?: ChatGptDesktopRequestBody | null;
  action: string;
  refreshOn401?: boolean;
  missingAuthErrorMessage?: string;
}

function isChatGptAuthMethod(value: string | null | undefined): boolean {
  return value === "chatgpt" || value === "chatgptAuthTokens";
}

function resolveMissingAuthErrorMessage(input: ChatGptDesktopRequestInput): string {
  return input.missingAuthErrorMessage
    ?? `Sign in to ChatGPT in Codex Desktop to ${input.action}.`;
}

function resolveRequestUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return new URL(path.replace(/^\/+/, ""), `${normalizedBaseUrl}/`).toString();
}

export function buildChatGptDesktopUserAgent(appVersion: string): string {
  return `${CHATGPT_DESKTOP_ORIGINATOR}/${appVersion} (${platform}; ${arch})`;
}

export function extractChatGptAccountIdFromAuthToken(token: string): string | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"];
    if (typeof auth !== "object" || auth === null) {
      return null;
    }

    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim().length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

function buildHeaders(
  authToken: string,
  input: ChatGptDesktopRequestInput,
  getAppVersion: () => string,
): Headers {
  const headers = new Headers(input.headers);
  headers.set("Authorization", `Bearer ${authToken}`);

  const accountId = extractChatGptAccountIdFromAuthToken(authToken);
  if (accountId && !headers.has("ChatGPT-Account-Id")) {
    headers.set("ChatGPT-Account-Id", accountId);
  }
  if (!headers.has("originator")) {
    headers.set("originator", CHATGPT_DESKTOP_ORIGINATOR);
  }
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", buildChatGptDesktopUserAgent(getAppVersion()));
  }

  return headers;
}

function prepareChatGptDesktopBody(input: ChatGptDesktopRequestInput): {
  headers: ChatGptDesktopRequestHeaders | undefined;
  body: ChatGptDesktopRequestBody | null | undefined;
} {
  const headers = new Headers(input.headers);
  const isBase64Encoded = headers.get("X-Codex-Base64") === "1";
  if (!isBase64Encoded || typeof input.body !== "string") {
    return {
      headers,
      body: input.body,
    };
  }

  headers.delete("X-Codex-Base64");
  const decoded = Buffer.from(input.body, "base64");
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  return {
    headers,
    body: bytes.buffer,
  };
}

async function readChatGptAuthToken(
  deps: ChatGptDesktopRequestDependencies,
  input: ChatGptDesktopRequestInput,
  refreshToken: boolean,
): Promise<string> {
  const authStatus = await deps.readAuthStatus({ includeToken: true, refreshToken });
  const authToken = typeof authStatus.authToken === "string" ? authStatus.authToken.trim() : "";
  if (!isChatGptAuthMethod(authStatus.authMethod) || authToken.length === 0) {
    throw new Error(resolveMissingAuthErrorMessage(input));
  }
  return authToken;
}

async function performRequest(
  deps: ChatGptDesktopRequestDependencies,
  input: ChatGptDesktopRequestInput,
  authToken: string,
): Promise<Response> {
  const url = resolveRequestUrl(input.baseUrl, input.path);
  const prepared = prepareChatGptDesktopBody(input);
  return await deps.fetchImpl(url, {
    method: input.method,
    headers: buildHeaders(authToken, {
      ...input,
      headers: prepared.headers,
    }, deps.getAppVersion),
    body: prepared.body ?? undefined,
  });
}

export async function requestChatGptDesktop(
  deps: ChatGptDesktopRequestDependencies,
  input: ChatGptDesktopRequestInput,
): Promise<Response> {
  const authToken = await readChatGptAuthToken(deps, input, false);
  const response = await performRequest(deps, input, authToken);
  if (response.status !== 401 || input.refreshOn401 === false) {
    return response;
  }

  const refreshedAuthToken = await readChatGptAuthToken(deps, input, true);
  return await performRequest(deps, input, refreshedAuthToken);
}
