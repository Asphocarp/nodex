import { describe, expect, test } from "bun:test";
import {
  buildChatGptDesktopUserAgent,
  CHATGPT_DESKTOP_ORIGINATOR,
  extractChatGptAccountIdFromAuthToken,
  requestChatGptDesktop,
} from "./chatgpt-desktop-request";

function buildAuthToken(accountId = "acct_123"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
    },
  })).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("chatgpt desktop request helper", () => {
  test("injects desktop auth headers and preserves caller headers", async () => {
    const authToken = buildAuthToken("acct_abc");
    let capturedUrl = "";
    let capturedInit: RequestInit | null = null;

    const response = await requestChatGptDesktop({
      readAuthStatus: async () => ({
        authMethod: "chatgpt",
        authToken,
        requiresOpenaiAuth: false,
      }),
      fetchImpl: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response("{}", { status: 200 });
      },
      getAppVersion: () => "0.1.8",
    }, {
      action: "transcribe audio",
      baseUrl: "https://chatgpt.com/backend-api/",
      path: "/transcribe",
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=test",
        "X-Codex-Base64": "1",
      },
      body: "cGF5bG9hZA==",
    });

    expect(response.status).toBe(200);
    expect(capturedUrl).toBe("https://chatgpt.com/backend-api/transcribe");

    if (!capturedInit) {
      throw new Error("Expected fetch init");
    }

    const fetchInit = capturedInit as RequestInit;
    const headers = new Headers(fetchInit.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${authToken}`);
    expect(headers.get("ChatGPT-Account-Id")).toBe("acct_abc");
    expect(headers.get("originator")).toBe(CHATGPT_DESKTOP_ORIGINATOR);
    expect(headers.get("User-Agent")).toBe(buildChatGptDesktopUserAgent("0.1.8"));
    expect(headers.get("Content-Type")).toBe("multipart/form-data; boundary=test");
    expect(headers.get("X-Codex-Base64")).toBe(null);

    const bodyBytes = new Uint8Array(await new Response(fetchInit.body).arrayBuffer());
    expect(Buffer.from(bodyBytes).toString("utf8")).toBe("payload");
  });

  test("decodes X-Codex-Base64 request bodies before fetch", async () => {
    let capturedInit: RequestInit | null = null;

    await requestChatGptDesktop({
      readAuthStatus: async () => ({
        authMethod: "chatgpt",
        authToken: buildAuthToken(),
        requiresOpenaiAuth: false,
      }),
      fetchImpl: async (_url, init) => {
        capturedInit = init;
        return new Response("{}", { status: 200 });
      },
      getAppVersion: () => "0.1.8",
    }, {
      action: "transcribe audio",
      baseUrl: "https://chatgpt.com/backend-api",
      path: "/transcribe",
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=test",
        "X-Codex-Base64": "1",
      },
      body: "YmFzZTY0LXBheWxvYWQ=",
    });

    if (!capturedInit) {
      throw new Error("Expected fetch init");
    }

    const fetchInit = capturedInit as RequestInit;
    const headers = new Headers(fetchInit.headers);
    expect(headers.get("X-Codex-Base64")).toBe(null);
    const bodyBytes = new Uint8Array(await new Response(fetchInit.body).arrayBuffer());
    expect(Buffer.from(bodyBytes).toString("utf8")).toBe("base64-payload");
  });

  test("retries once with a refreshed token after a 401", async () => {
    const refreshFlags: boolean[] = [];
    const seenAuthorizations: string[] = [];

    const response = await requestChatGptDesktop({
      readAuthStatus: async ({ refreshToken }) => {
        refreshFlags.push(refreshToken);
        return {
          authMethod: "chatgpt",
          authToken: refreshToken ? buildAuthToken("acct_second") : buildAuthToken("acct_first"),
          requiresOpenaiAuth: false,
        };
      },
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init.headers);
        seenAuthorizations.push(headers.get("Authorization") ?? "");
        return seenAuthorizations.length === 1
          ? new Response("unauthorized", { status: 401 })
          : new Response("{}", { status: 200 });
      },
      getAppVersion: () => "0.1.8",
    }, {
      action: "transcribe audio",
      baseUrl: "https://chatgpt.com/backend-api",
      path: "/transcribe",
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(refreshFlags.join(",")).toBe("false,true");
    expect(seenAuthorizations.length).toBe(2);
    expect(seenAuthorizations[0]?.includes("acct_first")).toBeFalse();
    expect(seenAuthorizations[1]?.includes("acct_second")).toBeFalse();
  });

  test("does not retry a 403 response", async () => {
    let fetchCallCount = 0;
    const response = await requestChatGptDesktop({
      readAuthStatus: async () => ({
        authMethod: "chatgpt",
        authToken: buildAuthToken(),
        requiresOpenaiAuth: false,
      }),
      fetchImpl: async () => {
        fetchCallCount += 1;
        return new Response("forbidden", { status: 403 });
      },
      getAppVersion: () => "0.1.8",
    }, {
      action: "transcribe audio",
      baseUrl: "https://chatgpt.com/backend-api",
      path: "/transcribe",
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(fetchCallCount).toBe(1);
  });

  test("throws the caller-provided auth error when chatgpt auth is unavailable", async () => {
    let didThrow = false;

    try {
      await requestChatGptDesktop({
        readAuthStatus: async () => ({
          authMethod: "apikey",
          authToken: null,
          requiresOpenaiAuth: false,
        }),
        fetchImpl: async () => new Response("{}", { status: 200 }),
        getAppVersion: () => "0.1.8",
      }, {
        action: "transcribe audio",
        baseUrl: "https://chatgpt.com/backend-api",
        path: "/transcribe",
        method: "POST",
        missingAuthErrorMessage: "ChatGPT authentication is required for dictation.",
      });
    } catch (error) {
      didThrow = true;
      expect((error as Error).message).toBe("ChatGPT authentication is required for dictation.");
    }

    expect(didThrow).toBeTrue();
  });

  test("extracts the ChatGPT account id from a JWT payload", () => {
    expect(extractChatGptAccountIdFromAuthToken(buildAuthToken("acct_xyz"))).toBe("acct_xyz");
    expect(extractChatGptAccountIdFromAuthToken("not-a-token")).toBe(null);
  });
});
