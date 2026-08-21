import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { makeBrowserCredentialRuntime } from "./browser-credential-service";
import { BrowserCredentialVault } from "./browser-credential-vault";
import type { BrowserProfileHelperRequest } from "./browser-profile-helper-client";
import {
  makeBrowserProfileImportRuntime,
  type BrowserProfileImportRuntimeOptions,
} from "./browser-profile-importer";

const makeSourceRoot = (source: "atlas" | "chrome") => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nodex-${source}-profile-`));
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
  return { root, profilePath: fs.realpathSync(profilePath) };
};

const makeVault = (root: string) =>
  new BrowserCredentialVault({
    filePath: path.join(root, "vault.json"),
    encryption: {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(`secure:${value}`),
      decryptString: (value) => value.toString().slice("secure:".length),
    },
  });

const makeCredentials = (vault: BrowserCredentialVault) =>
  makeBrowserCredentialRuntime({
    vault,
    resolveGuest: () => null,
    resolveGuestIdentity: () => null,
    resolveGuestOwner: () => null,
  });

const withRoots = <A, E, R>(
  run: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "nodex-profile-import-runtime-"))),
    run,
    (root) => Effect.sync(() => fs.rmSync(root, { recursive: true, force: true })),
  );

it.effect("discovers only concrete Chrome and Atlas profiles with available data", () =>
  withRoots((root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const chrome = makeSourceRoot("chrome");
        const atlas = makeSourceRoot("atlas");
        try {
          const credentials = yield* makeCredentials(makeVault(root));
          const runtime = yield* makeBrowserProfileImportRuntime({
            cookieStore: { get: async () => [], set: async () => undefined },
            credentials,
            helper: { readProfile: () => Effect.die("unused") },
            homeDirectory: root,
            platform: "darwin",
            sourceRoots: { chrome: chrome.root, atlas: atlas.root },
          });
          const profiles = yield* runtime.listProfiles;
          assert.lengthOf(profiles, 2);
          assert.deepInclude(profiles[0], {
            source: "atlas",
            profileName: "Your ChatGPT Atlas",
            profilePath: atlas.profilePath,
            hasCookies: true,
            hasPasswords: true,
          });
          assert.deepInclude(profiles[1], {
            source: "chrome",
            profileName: "Person 1",
            profilePath: chrome.profilePath,
            hasCookies: true,
            hasPasswords: true,
          });
        } finally {
          fs.rmSync(chrome.root, { recursive: true, force: true });
          fs.rmSync(atlas.root, { recursive: true, force: true });
        }
      }),
    ),
  ),
);

it.effect("imports cookies and passwords through their unique authorities", () =>
  withRoots((root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const chrome = makeSourceRoot("chrome");
        try {
          const vault = makeVault(root);
          const credentials = yield* makeCredentials(vault);
          const setCookie = vi.fn(
            async (
              _details: Parameters<BrowserProfileImportRuntimeOptions["cookieStore"]["set"]>[0],
            ) => undefined,
          );
          const readProfile = vi.fn((_request: BrowserProfileHelperRequest) =>
            Effect.succeed({
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
            }),
          );
          const runtime = yield* makeBrowserProfileImportRuntime({
            cookieStore: { get: async () => [], set: setCookie },
            credentials,
            helper: { readProfile },
            homeDirectory: root,
            platform: "darwin",
            sourceRoots: { chrome: chrome.root, atlas: "/missing" },
            now: () => 1_800_000_000_000,
          });

          const result = yield* runtime.importProfile({
            source: "chrome",
            profilePath: chrome.profilePath,
            importCookies: true,
            importPasswords: true,
            cookieDomainAllowlist: ["example.com"],
          });
          assert.deepInclude(readProfile.mock.calls[0]?.[0], {
            cookieDomainAllowlist: ["example.com"],
          });
          assert.deepInclude(setCookie.mock.calls[0]?.[0], {
            url: "https://example.com/",
            value: "cookie-secret",
          });
          assert.lengthOf(vault.listForOrigin("https://example.com"), 1);
          assert.deepInclude(result.cookies, { imported: 1, status: "success" });
          assert.deepInclude(result.passwords, { imported: 1, status: "success" });
          assert.deepEqual(fs.readdirSync(chrome.root), ["Default", "Local State"]);
        } finally {
          fs.rmSync(chrome.root, { recursive: true, force: true });
        }
      }),
    ),
  ),
);

it.effect("serializes imports before starting the profile helper", () =>
  withRoots((root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const chrome = makeSourceRoot("chrome");
        try {
          const firstEntered = yield* Deferred.make<void>();
          const releaseFirst = yield* Deferred.make<void>();
          const credentials = yield* makeCredentials(makeVault(root));
          let calls = 0;
          let active = 0;
          let maxActive = 0;
          const response = {
            schemaVersion: 1 as const,
            ok: true,
            cookies: [],
            credentials: [],
            cookieFailures: 0,
            passwordFailures: 0,
            errorCode: null,
          };
          const runtime = yield* makeBrowserProfileImportRuntime({
            cookieStore: { get: async () => [], set: async () => undefined },
            credentials,
            helper: {
              readProfile: () =>
                Effect.acquireUseRelease(
                  Effect.sync(() => {
                    calls += 1;
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    return calls;
                  }),
                  (call) =>
                    call === 1
                      ? Deferred.succeed(firstEntered, undefined).pipe(
                          Effect.andThen(Deferred.await(releaseFirst)),
                          Effect.as(response),
                        )
                      : Effect.succeed(response),
                  () => Effect.sync(() => void (active -= 1)),
                ),
            },
            homeDirectory: root,
            platform: "darwin",
            sourceRoots: { chrome: chrome.root, atlas: "/missing" },
          });
          const input = {
            source: "chrome" as const,
            profilePath: chrome.profilePath,
            importCookies: true,
            importPasswords: false,
          };
          const first = yield* Effect.forkChild(runtime.importProfile(input), {
            startImmediately: true,
          });
          yield* Deferred.await(firstEntered);
          const second = yield* Effect.forkChild(runtime.importProfile(input), {
            startImmediately: true,
          });
          yield* Effect.yieldNow;
          assert.strictEqual(calls, 1);
          assert.strictEqual(maxActive, 1);

          yield* Deferred.succeed(releaseFirst, undefined);
          yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
          assert.strictEqual(calls, 2);
          assert.strictEqual(maxActive, 1);
        } finally {
          fs.rmSync(chrome.root, { recursive: true, force: true });
        }
      }),
    ),
  ),
);

it.effect("refuses live or renderer-substituted profiles before invoking the helper", () =>
  withRoots((root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const chrome = makeSourceRoot("chrome");
        try {
          fs.symlinkSync("host-42", path.join(chrome.root, "SingletonLock"));
          const credentials = yield* makeCredentials(makeVault(root));
          const readProfile = vi.fn((_request: BrowserProfileHelperRequest) =>
            Effect.die("unused"),
          );
          const runtime = yield* makeBrowserProfileImportRuntime({
            cookieStore: { get: async () => [], set: async () => undefined },
            credentials,
            helper: { readProfile },
            homeDirectory: root,
            platform: "darwin",
            sourceRoots: { chrome: chrome.root, atlas: "/missing" },
            isProcessAlive: (pid) => pid === 42,
          });

          const liveError = yield* runtime
            .importProfile({
              source: "chrome",
              profilePath: chrome.profilePath,
              importCookies: true,
              importPasswords: false,
            })
            .pipe(Effect.flip);
          assert.include(String(liveError.cause), "Close Google Chrome");

          fs.unlinkSync(path.join(chrome.root, "SingletonLock"));
          const pathError = yield* runtime
            .importProfile({
              source: "chrome",
              profilePath: path.join(chrome.root, "..", "other"),
              importCookies: true,
              importPasswords: false,
            })
            .pipe(Effect.flip);
          assert.include(String(pathError.cause), "no longer importable");
          assert.lengthOf(readProfile.mock.calls, 0);
        } finally {
          fs.rmSync(chrome.root, { recursive: true, force: true });
        }
      }),
    ),
  ),
);
