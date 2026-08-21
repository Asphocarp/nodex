import { describe, expect, test } from "vitest";
import {
  validateBrowserUseAllowedApiRequest,
  type BrowserUseAuthenticatedFetchRule,
} from "./authenticated-fetch-bridge";

const rules: BrowserUseAuthenticatedFetchRule[] = [
  {
    origin: "https://chatgpt.com",
    pathPrefix: "/backend-api/aura/",
    methods: ["GET"],
    allowedRequestHeaders: ["accept"],
  },
  {
    origin: "https://chatgpt.com",
    pathPrefix: "/backend-api/browser-use",
    methods: ["POST"],
    allowedRequestHeaders: ["content-type"],
    maxRequestBodyBytes: 16,
  },
];

describe("Browser Use authenticated fetch bridge validation", () => {
  test("accepts a full allowlisted URL and normalizes caller headers", () => {
    const result = validateBrowserUseAllowedApiRequest(
      {
        url: "https://chatgpt.com/backend-api/aura/site_status?site_url=https%3A%2F%2Fexample.com",
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      rules,
    );

    expect(result).toEqual({
      ok: true,
      request: {
        url: "https://chatgpt.com/backend-api/aura/site_status?site_url=https%3A%2F%2Fexample.com",
        method: "GET",
        headers: {
          accept: "application/json",
        },
        body: null,
      },
      rule: rules[0],
    });
  });

  test("rejects non-allowlisted origins, paths, and methods", () => {
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "https://example.com/backend-api/aura/site_status",
          method: "GET",
        },
        rules,
      ),
    ).toMatchObject({
      ok: false,
      code: "target-not-allowlisted",
    });
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "https://chatgpt.com/backend-api/private",
          method: "GET",
        },
        rules,
      ),
    ).toMatchObject({
      ok: false,
      code: "target-not-allowlisted",
    });
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "https://chatgpt.com/backend-api/aura/site_status",
          method: "DELETE",
        },
        rules,
      ),
    ).toMatchObject({
      ok: false,
      code: "method-not-allowlisted",
    });
  });

  test("prevents callers from supplying authentication headers", () => {
    const result = validateBrowserUseAllowedApiRequest(
      {
        url: "https://chatgpt.com/backend-api/aura/site_status",
        method: "GET",
        headers: {
          Authorization: "Bearer attacker-controlled",
        },
      },
      rules,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "header-not-allowlisted",
    });
  });

  test("enforces body semantics and byte limits", () => {
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "https://chatgpt.com/backend-api/aura/site_status",
          method: "GET",
          body: "{}",
        },
        rules,
      ),
    ).toMatchObject({
      ok: false,
      code: "body-not-allowed",
    });
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "https://chatgpt.com/backend-api/browser-use/action",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "😀".repeat(5),
        },
        rules,
      ),
    ).toMatchObject({
      ok: false,
      code: "body-too-large",
    });
  });

  test("fails closed for malformed requests and malformed allowlists", () => {
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "/backend-api/aura/site_status",
          method: "GET",
        },
        rules,
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid-request",
    });
    expect(
      validateBrowserUseAllowedApiRequest(
        {
          url: "https://chatgpt.com/backend-api/aura/site_status",
          method: "GET",
        },
        [
          {
            origin: "https://chatgpt.com/backend-api",
            pathPrefix: "/aura/",
            methods: ["GET"],
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid-allowlist",
    });
  });
});
