import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BrowserCapabilityStatus,
  BrowserProfileImportDataResult,
  BrowserProfileImportInput,
  BrowserProfileImportResult,
  BrowserProfileSource,
  ImportableBrowserProfile,
} from "../../shared/browser-profile";
import type { BrowserCredentialVault } from "./browser-credential-vault";
import {
  BrowserProfileHelperClient,
  type BrowserProfileHelperResponse,
} from "./browser-profile-helper-client";

interface BrowserCookie {
  domain?: string;
  name: string;
  path?: string;
  value: string;
}

interface BrowserCookieStore {
  get(filter: Record<string, never>): Promise<BrowserCookie[]>;
  set(details: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
  }): Promise<void>;
}

export interface BrowserProfileImporterOptions {
  cookieStore: BrowserCookieStore;
  credentialVault: BrowserCredentialVault;
  helper: Pick<BrowserProfileHelperClient, "readProfile">;
  sourceRoots?: Partial<Record<BrowserProfileSource, string>>;
  now?: () => number;
}

interface BrowserSourceDefinition {
  source: BrowserProfileSource;
  appName: string;
  rootPath: string;
}

export class BrowserProfileImporter {
  private readonly cookieStore: BrowserCookieStore;
  private readonly credentialVault: BrowserCredentialVault;
  private readonly helper: Pick<BrowserProfileHelperClient, "readProfile">;
  private readonly sourceRoots: Partial<Record<BrowserProfileSource, string>>;
  private readonly now: () => number;

  constructor(options: BrowserProfileImporterOptions) {
    this.cookieStore = options.cookieStore;
    this.credentialVault = options.credentialVault;
    this.helper = options.helper;
    this.sourceRoots = options.sourceRoots ?? {};
    this.now = options.now ?? Date.now;
  }

  capability(): BrowserCapabilityStatus {
    if (process.platform !== "darwin") {
      return {
        available: false,
        provider: "unavailable",
        reason: "Browser Profile import is unavailable on this platform",
      };
    }
    if (!this.credentialVault.capability().available) {
      return {
        available: false,
        provider: "unavailable",
        reason: "Secure credential storage is unavailable on this device",
      };
    }
    return {
      available: true,
      provider: "nodex-profile-import",
    };
  }

  async listProfiles(): Promise<ImportableBrowserProfile[]> {
    const profiles = this.sourceDefinitions().flatMap((definition) => discoverProfiles(definition));
    return profiles.sort((left, right) => {
      if (left.source !== right.source) return left.source === "atlas" ? -1 : 1;
      return left.profileName.localeCompare(right.profileName);
    });
  }

  async import(input: BrowserProfileImportInput): Promise<BrowserProfileImportResult> {
    if (!input.importCookies && !input.importPasswords) {
      throw new Error("Select cookies, passwords, or both to import");
    }
    if (!input.importCookies && input.cookieDomainAllowlist !== undefined) {
      throw new Error("Cookie domain selection requires cookie import");
    }
    const profile = (await this.listProfiles()).find(
      (candidate) =>
        candidate.source === input.source && candidate.profilePath === input.profilePath,
    );
    if (!profile) {
      throw new Error("Browser Profile is no longer importable");
    }
    if (profile.sourceBrowserOpen) {
      throw new Error(`Close ${profile.appName} completely before importing`);
    }
    if (input.importPasswords && !this.credentialVault.capability().available) {
      throw new Error("Secure credential storage is unavailable");
    }

    const helperResult = await this.helper.readProfile({
      source: input.source,
      profilePath: profile.profilePath,
      includeCookies: input.importCookies,
      includePasswords: input.importPasswords,
      cookieDomainAllowlist: input.cookieDomainAllowlist,
    });
    const result: BrowserProfileImportResult = {
      source: input.source,
      profilePath: profile.profilePath,
    };
    if (input.importCookies) {
      result.cookies = await this.importCookies(helperResult);
    }
    if (input.importPasswords) {
      result.passwords = await this.importPasswords(helperResult);
    }
    return result;
  }

  private async importCookies(
    helperResult: BrowserProfileHelperResponse,
  ): Promise<BrowserProfileImportDataResult> {
    const existing = new Map(
      (await this.cookieStore.get({})).map((cookie) => [
        cookieKey(cookie.domain ?? "", cookie.name, cookie.path ?? "/"),
        cookie.value,
      ]),
    );
    let imported = 0;
    let skippedExisting = 0;
    let skippedInvalid = 0;
    let failed = helperResult.cookieFailures;
    for (const cookie of helperResult.cookies) {
      const host = cookie.domain.replace(/^\./u, "");
      const expirationDate = cookie.expirationDate ?? undefined;
      if (
        !isSafeCookieHost(host) ||
        (expirationDate !== undefined && expirationDate <= this.now() / 1_000)
      ) {
        skippedInvalid += 1;
        continue;
      }
      const key = cookieKey(cookie.domain, cookie.name, cookie.path);
      if (existing.get(key) === cookie.value) {
        skippedExisting += 1;
        continue;
      }
      try {
        await this.cookieStore.set({
          url: `${cookie.secure ? "https" : "http"}://${host}${normalizeCookiePath(cookie.path)}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: normalizeCookiePath(cookie.path),
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          ...(expirationDate === undefined ? {} : { expirationDate }),
          sameSite: cookie.sameSite,
        });
        existing.set(key, cookie.value);
        imported += 1;
      } catch {
        failed += 1;
      }
    }
    return importDataResult({
      discovered: helperResult.cookies.length + helperResult.cookieFailures,
      imported,
      skippedExisting,
      skippedInvalid,
      failed,
    });
  }

  private async importPasswords(
    helperResult: BrowserProfileHelperResponse,
  ): Promise<BrowserProfileImportDataResult> {
    let imported = 0;
    let skippedExisting = 0;
    let skippedInvalid = 0;
    let failed = helperResult.passwordFailures;
    for (const credential of helperResult.credentials) {
      try {
        if (await this.credentialVault.matches(credential)) {
          skippedExisting += 1;
          continue;
        }
        await this.credentialVault.save(credential);
        imported += 1;
      } catch (error) {
        if (error instanceof Error && /origin|username|password/iu.test(error.message)) {
          skippedInvalid += 1;
          continue;
        }
        failed += 1;
      }
    }
    return importDataResult({
      discovered: helperResult.credentials.length + helperResult.passwordFailures,
      imported,
      skippedExisting,
      skippedInvalid,
      failed,
    });
  }

  private sourceDefinitions(): BrowserSourceDefinition[] {
    const applicationSupport = path.join(os.homedir(), "Library", "Application Support");
    return [
      {
        source: "atlas",
        appName: "ChatGPT Atlas",
        rootPath:
          this.sourceRoots.atlas ??
          path.join(applicationSupport, "com.openai.atlas", "browser-data", "host"),
      },
      {
        source: "chrome",
        appName: "Google Chrome",
        rootPath: this.sourceRoots.chrome ?? path.join(applicationSupport, "Google", "Chrome"),
      },
    ];
  }
}

function discoverProfiles(definition: BrowserSourceDefinition): ImportableBrowserProfile[] {
  const rootMetadata = safeLstat(definition.rootPath);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) return [];
  const rootPath = safeRealpath(definition.rootPath);
  if (!rootPath) return [];
  const profileMetadata = readProfileInfoCache(path.join(rootPath, "Local State"));
  const sourceBrowserOpen = isSourceBrowserOpen(rootPath);
  const profiles: ImportableBrowserProfile[] = [];
  for (const [directoryName, metadata] of Object.entries(profileMetadata)) {
    const profilePath = safeRealpath(path.join(rootPath, directoryName));
    if (!profilePath || !isPathInside(profilePath, rootPath)) continue;
    const profileStats = safeLstat(profilePath);
    if (!profileStats?.isDirectory() || profileStats.isSymbolicLink()) continue;
    const hasCookies = isRegularFile(path.join(profilePath, "Cookies"));
    const hasPasswords = isRegularFile(path.join(profilePath, "Login Data"));
    if (!hasCookies && !hasPasswords) continue;
    const gaiaName = readNonEmptyString(metadata.gaia_name);
    const userName = readNonEmptyString(metadata.user_name);
    profiles.push({
      source: definition.source,
      appName: definition.appName,
      profileName: readNonEmptyString(metadata.name) ?? directoryName,
      profileDirectoryName: directoryName,
      profilePath,
      rootPath,
      hasCookies,
      hasPasswords,
      sourceBrowserOpen,
      ...(gaiaName ? { gaiaName } : {}),
      ...(userName ? { userName } : {}),
    });
  }
  return profiles;
}

function readProfileInfoCache(localStatePath: string): Record<string, Record<string, unknown>> {
  try {
    const value = JSON.parse(fs.readFileSync(localStatePath, "utf8")) as unknown;
    if (!isRecord(value) || !isRecord(value.profile) || !isRecord(value.profile.info_cache)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value.profile.info_cache).filter(
        (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function isSourceBrowserOpen(rootPath: string): boolean {
  const lockPath = path.join(rootPath, "SingletonLock");
  let target: string;
  try {
    const metadata = fs.lstatSync(lockPath);
    if (!metadata.isSymbolicLink()) return false;
    target = fs.readlinkSync(lockPath);
  } catch {
    return false;
  }
  const pid = Number.parseInt(/-(\d+)$/u.exec(target)?.[1] ?? "", 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function importDataResult(
  input: Omit<BrowserProfileImportDataResult, "status">,
): BrowserProfileImportDataResult {
  return {
    ...input,
    status:
      input.failed > 0
        ? input.imported > 0 || input.skippedExisting > 0
          ? "partial-success"
          : "failed"
        : "success",
  };
}

function cookieKey(domain: string, name: string, cookiePath: string): string {
  return `${domain.toLowerCase()}\0${name}\0${normalizeCookiePath(cookiePath)}`;
}

function normalizeCookiePath(value: string): string {
  return value.startsWith("/") ? value : "/";
}

function isSafeCookieHost(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    !value.includes("/") &&
    !value.includes(":") &&
    !/\s/u.test(value)
  );
}

function isRegularFile(value: string): boolean {
  const metadata = safeLstat(value);
  return metadata?.isFile() === true && !metadata.isSymbolicLink();
}

function safeLstat(value: string): fs.Stats | null {
  try {
    return fs.lstatSync(value);
  } catch {
    return null;
  }
}

function safeRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
