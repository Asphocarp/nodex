import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BrowserCredentialVault } from "./browser-credential-vault";
import { BrowserProfileImporter } from "./browser-profile-importer";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeSourceRoot(source: "atlas" | "chrome") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nodex-${source}-profile-`));
  roots.push(root);
  const profilePath = path.join(root, "Default");
  fs.mkdirSync(profilePath);
  fs.writeFileSync(path.join(profilePath, "Cookies"), "fixture");
  fs.writeFileSync(path.join(profilePath, "Login Data"), "fixture");
  fs.writeFileSync(
    path.join(root, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          Default: {
            name: source === "atlas" ? "Your ChatGPT Atlas" : "Person 1",
            gaia_name: "Example Person",
            user_name: "person@example.com",
          },
        },
      },
    }),
  );
  return {
    root,
    profilePath: fs.realpathSync(profilePath),
  };
}

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-import-vault-"));
  roots.push(root);
  return new BrowserCredentialVault({
    filePath: path.join(root, "vault.json"),
    encryption: {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(`secure:${value}`),
      decryptString: (value) => value.toString().slice("secure:".length),
    },
  });
}

describe("BrowserProfileImporter", () => {
  test("discovers only concrete Chrome and Atlas profiles with available data", async () => {
    const chrome = makeSourceRoot("chrome");
    const atlas = makeSourceRoot("atlas");
    const importer = new BrowserProfileImporter({
      cookieStore: {
        get: async () => [],
        set: async () => undefined,
      },
      credentialVault: makeVault(),
      helper: { readProfile: vi.fn() },
      sourceRoots: { chrome: chrome.root, atlas: atlas.root },
    });

    expect(await importer.listProfiles()).toMatchObject([
      {
        source: "atlas",
        profileName: "Your ChatGPT Atlas",
        profilePath: atlas.profilePath,
        hasCookies: true,
        hasPasswords: true,
      },
      {
        source: "chrome",
        profileName: "Person 1",
        profilePath: chrome.profilePath,
        hasCookies: true,
        hasPasswords: true,
      },
    ]);
  });

  test("imports cookies and passwords idempotently without a plaintext intermediate file", async () => {
    const chrome = makeSourceRoot("chrome");
    const setCookie = vi.fn(async () => undefined);
    const vault = makeVault();
    const helper = {
      readProfile: vi.fn(async () => ({
        schemaVersion: 1 as const,
        ok: true,
        cookies: [
          {
            domain: ".example.com",
            name: "session",
            value: "cookie-secret",
            path: "/",
            secure: true,
            httpOnly: true,
            expirationDate: 2_000_000_000,
            sameSite: "lax" as const,
          },
        ],
        credentials: [
          {
            origin: "https://example.com",
            username: "person",
            password: "password-secret",
          },
        ],
        cookieFailures: 0,
        passwordFailures: 0,
        errorCode: null,
      })),
    };
    const importer = new BrowserProfileImporter({
      cookieStore: {
        get: async () => [],
        set: setCookie,
      },
      credentialVault: vault,
      helper,
      sourceRoots: { chrome: chrome.root, atlas: "/missing" },
      now: () => 1_800_000_000_000,
    });

    const result = await importer.import({
      source: "chrome",
      profilePath: chrome.profilePath,
      importCookies: true,
      importPasswords: true,
      cookieDomainAllowlist: ["example.com"],
    });

    expect(helper.readProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        cookieDomainAllowlist: ["example.com"],
      }),
    );
    expect(setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/",
        value: "cookie-secret",
      }),
    );
    expect(await vault.listForOrigin("https://example.com")).toHaveLength(1);
    expect(result.cookies).toMatchObject({ imported: 1, status: "success" });
    expect(result.passwords).toMatchObject({ imported: 1, status: "success" });
    expect(fs.readdirSync(chrome.root)).toEqual(["Default", "Local State"]);
  });

  test("refuses to read a profile while the source browser lock owner is alive", async () => {
    const chrome = makeSourceRoot("chrome");
    fs.symlinkSync(`host-${process.pid}`, path.join(chrome.root, "SingletonLock"));
    const helper = { readProfile: vi.fn() };
    const importer = new BrowserProfileImporter({
      cookieStore: {
        get: async () => [],
        set: async () => undefined,
      },
      credentialVault: makeVault(),
      helper,
      sourceRoots: { chrome: chrome.root, atlas: "/missing" },
    });

    await expect(
      importer.import({
        source: "chrome",
        profilePath: chrome.profilePath,
        importCookies: true,
        importPasswords: false,
      }),
    ).rejects.toThrow("Close Google Chrome");
    expect(helper.readProfile).not.toHaveBeenCalled();
  });

  test("rejects a renderer-substituted profile path", async () => {
    const chrome = makeSourceRoot("chrome");
    const importer = new BrowserProfileImporter({
      cookieStore: {
        get: async () => [],
        set: async () => undefined,
      },
      credentialVault: makeVault(),
      helper: { readProfile: vi.fn() },
      sourceRoots: { chrome: chrome.root, atlas: "/missing" },
    });

    await expect(
      importer.import({
        source: "chrome",
        profilePath: path.join(chrome.root, "..", "other"),
        importCookies: true,
        importPasswords: false,
      }),
    ).rejects.toThrow("no longer importable");
  });
});
