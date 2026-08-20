import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";

import {
  NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV,
} from "../../shared/native-runtime-environment";
import type { BrowserProfileSource } from "../../shared/browser-profile";

const MAX_HELPER_OUTPUT_BYTES = 64 * 1024 * 1024;
const HELPER_TIMEOUT_MS = 30_000;

const ImportedCookieSchema = z.object({
  domain: z.string().min(1).max(253),
  name: z.string().max(8_192),
  value: z.string().max(1024 * 1024),
  path: z.string().min(1).max(16_384),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  expirationDate: z.number().finite().positive().nullable(),
  sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]),
}).strict();

const ImportedCredentialSchema = z.object({
  origin: z.string().url().max(16_384),
  username: z.string().max(8_192),
  password: z.string().min(1).max(1024 * 1024),
}).strict();

const HelperResponseSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.boolean(),
  cookies: z.array(ImportedCookieSchema).max(20_000),
  credentials: z.array(ImportedCredentialSchema).max(20_000),
  cookieFailures: z.number().int().nonnegative(),
  passwordFailures: z.number().int().nonnegative(),
  errorCode: z.string().max(128).nullable(),
}).strict();

export type BrowserProfileHelperResponse = z.infer<typeof HelperResponseSchema>;

export interface BrowserProfileHelperRequest {
  source: BrowserProfileSource;
  profilePath: string;
  includeCookies: boolean;
  includePasswords: boolean;
  cookieDomainAllowlist?: readonly string[];
}

export interface BrowserProfileHelperClientOptions {
  executablePath: string;
  timeoutMs?: number;
}

export class BrowserProfileHelperClient {
  private readonly executablePath: string;
  private readonly timeoutMs: number;

  constructor(options: BrowserProfileHelperClientOptions) {
    this.executablePath = path.resolve(options.executablePath);
    this.timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS;
  }

  async readProfile(
    request: BrowserProfileHelperRequest,
  ): Promise<BrowserProfileHelperResponse> {
    const response = await runHelper(
      this.executablePath,
      {
        schemaVersion: 1,
        operation: "read-profile",
        source: request.source,
        profilePath: request.profilePath,
        includeCookies: request.includeCookies,
        includePasswords: request.includePasswords,
        cookieDomainAllowlist: [...(request.cookieDomainAllowlist ?? [])],
      },
      this.timeoutMs,
    );
    const parsed = HelperResponseSchema.parse(response);
    if (parsed.ok) return parsed;
    throw new BrowserProfileHelperError(
      parsed.errorCode ?? "unknown_error",
    );
  }
}

export class BrowserProfileHelperError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Browser Profile helper failed: ${code}`);
    this.name = "BrowserProfileHelperError";
    this.code = code;
  }
}

export function resolveBrowserProfileHelperExecutable(options: {
  environment?: NodeJS.ProcessEnv;
  isPackaged: boolean;
  resourcesPath: string;
  repositoryRoot?: string;
}): string {
  const environment = options.environment ?? process.env;
  const override = environment[
    NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV
  ]?.trim();
  if (override) {
    if (path.isAbsolute(override)) return path.normalize(override);
    throw new Error(
      `${NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV} must be absolute`,
    );
  }
  if (options.isPackaged) {
    return path.join(
      options.resourcesPath,
      "bin",
      "nodex-browser-profile-helper",
    );
  }
  return path.join(
    options.repositoryRoot ?? process.cwd(),
    "target",
    "debug",
    "nodex-browser-profile-helper",
  );
}

async function runHelper(
  executablePath: string,
  request: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settleReject(new Error("Browser Profile helper timed out"));
    }, timeoutMs);
    timer.unref?.();

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const settleResolve = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };

    child.once("error", (error) => {
      settleReject(new Error(`Browser Profile helper could not start: ${error.message}`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_HELPER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        settleReject(new Error("Browser Profile helper response is too large"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 8_192) {
        child.kill("SIGKILL");
        settleReject(new Error("Browser Profile helper produced excessive diagnostics"));
      }
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        settleReject(new Error("Browser Profile helper exited unexpectedly"));
        return;
      }
      try {
        settleResolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        settleReject(new Error("Browser Profile helper returned invalid JSON"));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
