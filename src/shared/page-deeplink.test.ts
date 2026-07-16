import { describe, expect, test } from "vitest";
import {
  buildPageDeepLink,
  buildSessionDeepLink,
  parsePageDeepLink,
  parseSessionDeepLink,
} from "./page-deeplink";

describe("card deeplink", () => {
  test("builds nodex card deeplinks", () => {
    expect(buildPageDeepLink({ pageId: "card-42" })).toBe("nodex://pages/card-42");
  });

  test("parses nodex card deeplinks", () => {
    const target = parsePageDeepLink("nodex://pages/card-42");

    expect(target?.pageId).toBe("card-42");
  });

  test("parses card deeplinks while ignoring unsupported block query targets", () => {
    const target = parsePageDeepLink("nodex://pages/card-42?block=block-1");

    expect(target?.pageId).toBe("card-42");
  });

  test("parses alternate empty-host card deeplinks", () => {
    const target = parsePageDeepLink("nodex:///pages/card-42");

    expect(target?.pageId).toBe("card-42");
  });

  test("returns null for legacy singular deeplinks", () => {
    expect(parsePageDeepLink("nodex://card/card-42")).toBe(null);
  });

  test("returns null for unsupported deeplinks", () => {
    expect(parsePageDeepLink("nodex://thread/thread-1")).toBe(null);
  });
});

describe("session deeplink", () => {
  test("builds nodex session deeplinks", () => {
    expect(buildSessionDeepLink({ sessionId: "session-42" })).toBe("nodex://sessions/session-42");
  });

  test("parses nodex session deeplinks", () => {
    const target = parseSessionDeepLink("nodex://sessions/session-42");

    expect(target?.sessionId).toBe("session-42");
  });

  test("parses alternate empty-host session deeplinks", () => {
    const target = parseSessionDeepLink("nodex:///sessions/session-42");

    expect(target?.sessionId).toBe("session-42");
  });

  test("does not parse card deeplinks as session links", () => {
    expect(parseSessionDeepLink("nodex://pages/card-42")).toBe(null);
  });
});
