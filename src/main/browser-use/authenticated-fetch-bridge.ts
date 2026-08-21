import { z } from "zod";

const MAX_URL_LENGTH = 16_384;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 8_192;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 1024 * 1024;

const BrowserUseFetchMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HeaderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_HEADER_NAME_LENGTH)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u);
const RequestHeadersSchema = z
  .record(HeaderNameSchema, z.string().max(MAX_HEADER_VALUE_LENGTH))
  .refine((headers) => Object.keys(headers).length <= MAX_HEADER_COUNT);
const RequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  method: BrowserUseFetchMethodSchema,
  headers: RequestHeadersSchema.default({}),
  body: z.string().nullable().default(null),
});

export type BrowserUseAuthenticatedFetchMethod = z.infer<typeof BrowserUseFetchMethodSchema>;

export interface BrowserUseAllowedApiRequest {
  url: string;
  method: BrowserUseAuthenticatedFetchMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string | null;
}

export interface BrowserUseApiResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}

/**
 * Privileged implementations own authentication. Callers can only describe a
 * request which has passed validateBrowserUseAllowedApiRequest.
 */
export interface BrowserUseAuthenticatedFetchBridge {
  fetch(input: BrowserUseAllowedApiRequest): Promise<BrowserUseApiResponse>;
}

export interface BrowserUseAuthenticatedFetchRule {
  origin: string;
  pathPrefix: string;
  methods: readonly BrowserUseAuthenticatedFetchMethod[];
  allowedRequestHeaders?: readonly string[];
  maxRequestBodyBytes?: number;
}

export type BrowserUseFetchValidationErrorCode =
  | "invalid-request"
  | "target-not-allowlisted"
  | "method-not-allowlisted"
  | "header-not-allowlisted"
  | "body-not-allowed"
  | "body-too-large"
  | "invalid-allowlist";

export type BrowserUseAllowedApiRequestValidation =
  | {
      ok: true;
      request: Required<BrowserUseAllowedApiRequest>;
      rule: BrowserUseAuthenticatedFetchRule;
    }
  | {
      ok: false;
      code: BrowserUseFetchValidationErrorCode;
      message: string;
    };

const FORBIDDEN_CALLER_HEADERS = new Set([
  "authorization",
  "chatgpt-account-id",
  "cookie",
  "host",
  "originator",
  "proxy-authorization",
  "set-cookie",
  "user-agent",
]);

function invalid(
  code: BrowserUseFetchValidationErrorCode,
  message: string,
): BrowserUseAllowedApiRequestValidation {
  return { ok: false, code, message };
}

function parseRuleOrigin(origin: string): URL | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/") return null;
    return url;
  } catch {
    return null;
  }
}

function isValidPathPrefix(pathPrefix: string, origin: string): boolean {
  if (!pathPrefix.startsWith("/") || pathPrefix.includes("?") || pathPrefix.includes("#")) {
    return false;
  }

  try {
    return new URL(pathPrefix, origin).pathname === pathPrefix;
  } catch {
    return false;
  }
}

function matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix.endsWith("/")) return pathname.startsWith(pathPrefix);
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

function normalizeAllowedHeaders(rule: BrowserUseAuthenticatedFetchRule): Set<string> | null {
  const headers = rule.allowedRequestHeaders ?? [];
  if (headers.length > MAX_HEADER_COUNT) return null;

  const normalized = new Set<string>();
  for (const header of headers) {
    const parsed = HeaderNameSchema.safeParse(header);
    if (!parsed.success) return null;
    const name = parsed.data.toLowerCase();
    if (FORBIDDEN_CALLER_HEADERS.has(name)) return null;
    normalized.add(name);
  }
  return normalized;
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | null {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (Object.hasOwn(normalized, normalizedName)) return null;
    normalized[normalizedName] = value;
  }
  return normalized;
}

function requestBodyByteLength(body: string): number {
  return new TextEncoder().encode(body).byteLength;
}

export function validateBrowserUseAllowedApiRequest(
  input: unknown,
  rules: readonly BrowserUseAuthenticatedFetchRule[],
): BrowserUseAllowedApiRequestValidation {
  const requestResult = RequestSchema.safeParse(input);
  if (!requestResult.success) {
    return invalid("invalid-request", "The Browser Use API request is invalid.");
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(requestResult.data.url);
  } catch {
    return invalid("invalid-request", "The Browser Use API request URL is invalid.");
  }
  if (
    (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") ||
    requestUrl.username ||
    requestUrl.password ||
    requestUrl.hash
  ) {
    return invalid("invalid-request", "The Browser Use API request URL is invalid.");
  }

  const matchingOriginRules: Array<{
    rule: BrowserUseAuthenticatedFetchRule;
    allowedHeaders: Set<string>;
  }> = [];
  for (const rule of rules) {
    const origin = parseRuleOrigin(rule.origin);
    const allowedHeaders = normalizeAllowedHeaders(rule);
    const maxBodyBytes = rule.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
    if (
      !origin ||
      !isValidPathPrefix(rule.pathPrefix, origin.origin) ||
      rule.methods.length === 0 ||
      !rule.methods.every((method) => BrowserUseFetchMethodSchema.safeParse(method).success) ||
      !allowedHeaders ||
      !Number.isSafeInteger(maxBodyBytes) ||
      maxBodyBytes < 0
    ) {
      return invalid("invalid-allowlist", "The Browser Use API allowlist is invalid.");
    }

    if (
      requestUrl.origin === origin.origin &&
      matchesPathPrefix(requestUrl.pathname, rule.pathPrefix)
    ) {
      matchingOriginRules.push({ rule, allowedHeaders });
    }
  }

  if (matchingOriginRules.length === 0) {
    return invalid(
      "target-not-allowlisted",
      "The Browser Use API request target is not allowlisted.",
    );
  }

  const matchingMethodRules = matchingOriginRules.filter(({ rule }) =>
    rule.methods.includes(requestResult.data.method),
  );
  if (matchingMethodRules.length === 0) {
    return invalid(
      "method-not-allowlisted",
      "The Browser Use API request method is not allowlisted.",
    );
  }

  const headers = normalizeHeaders(requestResult.data.headers);
  if (!headers) {
    return invalid("invalid-request", "The Browser Use API request headers are invalid.");
  }

  const matchingHeaderRule = matchingMethodRules.find(({ allowedHeaders }) =>
    Object.keys(headers).every(
      (name) => !FORBIDDEN_CALLER_HEADERS.has(name) && allowedHeaders.has(name),
    ),
  );
  if (!matchingHeaderRule) {
    return invalid(
      "header-not-allowlisted",
      "A Browser Use API request header is not allowlisted.",
    );
  }

  const body = requestResult.data.body;
  if (body !== null && requestResult.data.method === "GET") {
    return invalid("body-not-allowed", "The Browser Use API request method does not allow a body.");
  }

  const maxBodyBytes =
    matchingHeaderRule.rule.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  if (body !== null && requestBodyByteLength(body) > maxBodyBytes) {
    return invalid(
      "body-too-large",
      "The Browser Use API request body exceeds the allowlisted size.",
    );
  }

  return {
    ok: true,
    request: {
      url: requestUrl.toString(),
      method: requestResult.data.method,
      headers,
      body,
    },
    rule: matchingHeaderRule.rule,
  };
}
