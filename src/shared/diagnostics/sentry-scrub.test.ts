import { describe, expect, test } from "bun:test";
import {
  scrubSentryBreadcrumb,
  scrubSentryData,
  scrubSentryEvent,
} from "./sentry-scrub";

describe("Sentry diagnostics scrubber", () => {
  test("redacts secret-bearing fields and prompt-like content", () => {
    const scrubbed = scrubSentryData({
      authorization: "Bearer abcdefghijklmnop",
      nested: {
        apiKey: "sk_test_1234567890123456",
        promptPreview: "summarize /Users/alice/private.md",
        transcript: "hidden thread transcript",
      },
    }) as Record<string, unknown>;

    expect(scrubbed.authorization).toBe("[REDACTED]");
    const nested = scrubbed.nested as Record<string, unknown>;
    expect(nested.apiKey).toBe("[REDACTED]");
    expect(nested.promptPreview).toBe("[REDACTED]");
    expect(nested.transcript).toBe("[REDACTED]");
  });

  test("scrubs local usernames and URL query strings while keeping useful messages", () => {
    const scrubbed = scrubSentryBreadcrumb({
      message: "Failed at /Users/alice/work/app.ts with https://example.com/path?token=abc#top",
      data: {
        cwd: "/home/bob/project",
      },
    });

    expect(scrubbed.message).toBe("Failed at /Users/[user]/work/app.ts with https://example.com/path");
    const data = scrubbed.data as Record<string, unknown>;
    expect(data.cwd).toBe("/home/[user]/project");
  });

  test("removes sensitive request payload fields from events", () => {
    const event = scrubSentryEvent({
      message: "request failed",
      request: {
        url: "https://api.example.com/items?authorization=abc",
        headers: { cookie: "secret" },
        data: { description: "private card" },
        query_string: "authorization=abc",
      },
    });

    const request = event.request as Record<string, unknown>;
    expect(event.message).toBe("request failed");
    expect(request.url).toBe("https://api.example.com/items");
    expect("headers" in request).toBeFalse();
    expect("data" in request).toBeFalse();
    expect("query_string" in request).toBeFalse();
  });
});
