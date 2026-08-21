import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import path from "node:path";
import { z } from "zod";
import type { BrowserProfileSource } from "../../shared/browser-profile";
import { NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV } from "../../shared/native-runtime-environment";

const ImportedCookieSchema = z
  .object({
    domain: z.string().min(1).max(253),
    name: z.string().max(8_192),
    value: z.string().max(1_024 * 1_024),
    path: z.string().min(1).max(16_384),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    expirationDate: z.number().finite().positive().nullable(),
    sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]),
  })
  .strict();

const ImportedCredentialSchema = z
  .object({
    origin: z.string().url().max(16_384),
    username: z.string().max(8_192),
    password: z
      .string()
      .min(1)
      .max(1_024 * 1_024),
  })
  .strict();

const HelperResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.boolean(),
    cookies: z.array(ImportedCookieSchema).max(20_000),
    credentials: z.array(ImportedCredentialSchema).max(20_000),
    cookieFailures: z.number().int().nonnegative(),
    passwordFailures: z.number().int().nonnegative(),
    errorCode: z.string().max(128).nullable(),
  })
  .strict();

export type BrowserProfileHelperResponse = z.infer<typeof HelperResponseSchema>;

export interface BrowserProfileHelperRequest {
  readonly source: BrowserProfileSource;
  readonly profilePath: string;
  readonly includeCookies: boolean;
  readonly includePasswords: boolean;
  readonly cookieDomainAllowlist?: readonly string[];
}

export class BrowserProfileHelperError extends Schema.TaggedError<BrowserProfileHelperError>()(
  "BrowserProfileHelperError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserProfileHelper {
  readonly readProfile: (
    request: BrowserProfileHelperRequest,
  ) => Effect.Effect<BrowserProfileHelperResponse, BrowserProfileHelperError>;
}

export interface BrowserProfileHelperOptions {
  readonly executablePath: string;
  readonly timeoutMs?: number;
}

/** Stable application port implemented by the Node child-process adapter. */
export class BrowserProfileHelperPlatform extends Context.Service<
  BrowserProfileHelperPlatform,
  { readonly make: (options: BrowserProfileHelperOptions) => BrowserProfileHelper }
>()("nodex/main/browser/BrowserProfileHelperPlatform") {}

export const decodeBrowserProfileHelperResponse = (raw: string): BrowserProfileHelperResponse => {
  const parsed = HelperResponseSchema.parse(JSON.parse(raw));
  if (parsed.ok) return parsed;
  throw new Error(`Browser Profile helper failed: ${parsed.errorCode ?? "unknown"}`);
};

export const resolveBrowserProfileHelperExecutable = (options: {
  readonly environment: Readonly<Record<string, string>>;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly repositoryRoot: string;
}): string => {
  const override = options.environment[NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV]?.trim();
  if (override) {
    if (path.isAbsolute(override)) return path.normalize(override);
    throw new TypeError(`${NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV} must be absolute`);
  }
  return options.isPackaged
    ? path.join(options.resourcesPath, "bin", "nodex-browser-profile-helper")
    : path.join(options.repositoryRoot, "target", "debug", "nodex-browser-profile-helper");
};
