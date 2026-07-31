import { describe, expect, test } from "vitest";
import vectors from "../../tests/fixtures/nodex-deeplinks.json";
import {
  buildPageDeepLink,
  buildSessionDeepLink,
  buildViewDeepLink,
  parsePageDeepLink,
  parseSessionDeepLink,
  parseViewDeepLink,
} from "./nodex-deeplink";

describe("Nodex deep-link conformance", () => {
  test.each(vectors.valid)(
    "builds and parses $kind vector $canonical",
    ({ accepted, canonical, id, kind }) => {
      const build = kind === "page"
        ? () => buildPageDeepLink({ pageId: id })
        : kind === "session"
          ? () => buildSessionDeepLink({ sessionId: id })
          : () => buildViewDeepLink({ viewId: id });
      const parse = kind === "page"
        ? (value: string) => parsePageDeepLink(value)?.pageId ?? null
        : kind === "session"
          ? (value: string) => parseSessionDeepLink(value)?.sessionId ?? null
          : (value: string) => parseViewDeepLink(value)?.viewId ?? null;

      expect(build()).toBe(canonical);
      for (const value of accepted) {
        expect(parse(value)).toBe(id);
      }
    },
  );

  test.each(vectors.invalid)("rejects $value", ({ value }) => {
    expect(parsePageDeepLink(value)).toBe(null);
    expect(parseSessionDeepLink(value)).toBe(null);
    expect(parseViewDeepLink(value)).toBe(null);
  });
});
