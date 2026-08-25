import { describe, expect, test, vi } from "vite-plus/test";

import { createSecureRuntimeId, createSecureUuid } from "./secure-runtime-id";

describe("secure runtime identities", () => {
  test("uses the injected secure UUID source without a weak fallback", () => {
    const createUuid = () => "019c8bd7-62eb-7000-8000-000000000001";

    expect(createSecureUuid(createUuid)).toBe("019c8bd7-62eb-7000-8000-000000000001");
    expect(createSecureRuntimeId("surface", createUuid)).toBe(
      "surface:019c8bd7-62eb-7000-8000-000000000001",
    );
  });

  test("fails closed when the default Web Crypto source is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => createSecureUuid()).toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
