import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import { describe, expect, test, vi } from "vitest";
import {
  CodexComposerExternalSuggestionService,
  parseComposerChatGptConversations,
  parseComposerSitesToolResponse,
} from "./composer-external-suggestion-service";

function buildConfig(baseUrl = "https://chatgpt.example.test/backend-api"): ConfigReadResponse {
  return {
    config: { chatgpt_base_url: baseUrl },
    origins: {},
    layers: [],
  } as unknown as ConfigReadResponse;
}

describe("CodexComposerExternalSuggestionService", () => {
  test("fails closed before external requests when ChatGPT auth is unavailable", async () => {
    const requestChatGptDesktop = vi.fn();
    const service = new CodexComposerExternalSuggestionService({
      readAuthMethod: vi.fn().mockResolvedValue("apiKey"),
      readConfig: vi.fn().mockResolvedValue(buildConfig()),
      requestChatGptDesktop,
    });

    await expect(service.listSites()).resolves.toEqual({
      available: false,
      sites: [],
    });
    await expect(service.listChatGptConversations("release")).resolves.toEqual({
      available: false,
      conversations: [],
    });
    expect(requestChatGptDesktop).not.toHaveBeenCalled();
  });

  test("gates Sites inventory through access before calling the bounded tool", async () => {
    const requestChatGptDesktop = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        result: {
          isError: false,
          structuredContent: {
            cursor: null,
            items: [
              {
                id: "appgprj_release",
                title: " Release notes ",
                slug: "release-notes",
                current_live_url: "https://release.chatgpt.site/docs?mode=live",
              },
              {
                id: "",
                title: "Invalid",
                slug: "invalid",
                current_live_url: null,
              },
            ],
          },
        },
      }), { status: 200 }));
    const service = new CodexComposerExternalSuggestionService({
      readAuthMethod: vi.fn().mockResolvedValue("chatgpt"),
      readConfig: vi.fn().mockResolvedValue(buildConfig()),
      requestChatGptDesktop,
    });

    await expect(service.listSites()).resolves.toEqual({
      available: true,
      sites: [{
        id: "appgprj_release",
        title: " Release notes ",
        slug: "release-notes",
        currentLiveUrl: "https://release.chatgpt.site/docs?mode=live",
        path: "sites-project://appgprj_release",
      }],
    });
    expect(requestChatGptDesktop).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: "https://chatgpt.example.test",
        method: "GET",
        path: "/wham/sites/access",
      }),
    );
    const toolCall = requestChatGptDesktop.mock.calls[1]?.[0];
    expect(toolCall).toEqual(expect.objectContaining({
      baseUrl: "https://chatgpt.example.test",
      method: "POST",
      path: "/wham/apps",
    }));
    expect(JSON.parse(toolCall?.body as string)).toEqual({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: { limit: 20 },
        name: "sites_list_sites",
      },
    });
  });

  test("uses recent and source-ranked search endpoints with canonical mention paths", async () => {
    const requestChatGptDesktop = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "recent/id", title: "Recent research" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          conversation_id: "search/id",
          title: "Searched research",
        }],
      }), { status: 200 }));
    const service = new CodexComposerExternalSuggestionService({
      readAuthMethod: vi.fn().mockResolvedValue("chatgptAuthTokens"),
      readConfig: vi.fn().mockResolvedValue(buildConfig()),
      requestChatGptDesktop,
    });

    await expect(service.listChatGptConversations("")).resolves.toEqual({
      available: true,
      conversations: [{
        conversationId: "recent/id",
        title: "Recent research",
        path: "chatgpt-conversation://recent%2Fid",
      }],
    });
    await expect(service.listChatGptConversations(" release plan ")).resolves.toEqual({
      available: true,
      conversations: [{
        conversationId: "search/id",
        title: "Searched research",
        path: "chatgpt-conversation://search%2Fid",
      }],
    });
    expect(requestChatGptDesktop).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: "https://chatgpt.example.test/backend-api",
        path: "/conversations?expand=false&is_archived=false&limit=5&order=updated&offset=0",
      }),
    );
    expect(requestChatGptDesktop).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "/conversations/search?query=release+plan",
      }),
    );
  });

  test("bounds ChatGPT search text before crossing the authenticated boundary", async () => {
    const requestChatGptDesktop = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    const service = new CodexComposerExternalSuggestionService({
      readAuthMethod: vi.fn().mockResolvedValue("chatgpt"),
      readConfig: vi.fn().mockResolvedValue(buildConfig()),
      requestChatGptDesktop,
    });

    await service.listChatGptConversations(`  ${"a".repeat(120)}  `);

    expect(requestChatGptDesktop).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/conversations/search?query=${"a".repeat(100)}`,
      }),
    );
  });
});

describe("composer external suggestion parsers", () => {
  test("rejects JSON-RPC failures and deduplicates malformed provider rows", () => {
    expect(parseComposerSitesToolResponse({
      result: { isError: true, structuredContent: { items: [] } },
    })).toEqual([]);
    expect(parseComposerChatGptConversations({
      items: [
        { conversation_id: "conversation-1", title: null },
        { id: "conversation-1", title: "duplicate" },
        { id: "", title: "invalid" },
      ],
    })).toEqual([{
      conversationId: "conversation-1",
      title: "",
      path: "chatgpt-conversation://conversation-1",
    }]);
  });
});
