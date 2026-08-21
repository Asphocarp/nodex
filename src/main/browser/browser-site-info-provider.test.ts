import { describe, expect, test, vi } from "vite-plus/test";
import { BrowserSiteInfoProvider } from "./browser-site-info-provider";

const identity = {
  browserConversationId: "conversation",
  browserViewScopeId: "scope",
  browserTabId: "tab",
};

describe("BrowserSiteInfoProvider", () => {
  test("returns Main-owned origin, cookie count, and fail-closed permissions", async () => {
    const cookies = { get: vi.fn(async () => [{}, {}]) };
    const provider = new BrowserSiteInfoProvider(
      {
        getTabSnapshot: () => ({
          url: "https://example.com/path?private=1",
        }),
      },
      cookies,
    );

    expect(await provider.get(identity)).toMatchObject({
      ...identity,
      origin: "https://example.com",
      connection: "secure",
      cookieCount: 2,
      permissions: expect.arrayContaining([
        { permission: "camera", state: "block" },
        { permission: "notifications", state: "block" },
      ]),
    });
    expect(cookies.get).toHaveBeenCalledWith({
      url: "https://example.com/path?private=1",
    });
  });

  test("classifies localhost separately from insecure remote HTTP", async () => {
    const cookieStore = { get: async () => [] };
    const local = new BrowserSiteInfoProvider(
      {
        getTabSnapshot: () => ({ url: "http://localhost:3000/" }),
      },
      cookieStore,
    );
    const remote = new BrowserSiteInfoProvider(
      {
        getTabSnapshot: () => ({ url: "http://example.com/" }),
      },
      cookieStore,
    );

    expect((await local.get(identity)).connection).toBe("local");
    expect((await remote.get(identity)).connection).toBe("insecure");
  });
});
