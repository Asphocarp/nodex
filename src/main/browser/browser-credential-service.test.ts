import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";
import { makeBrowserCredentialRuntime } from "./browser-credential-service";
import { BrowserCredentialVault } from "./browser-credential-vault";

const identity: BrowserSidebarTabIdentity = {
  browserConversationId: "conversation",
  browserViewScopeId: "scope",
  browserTabId: "tab",
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const makeVault = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-credential-runtime-"));
  roots.push(root);
  return new BrowserCredentialVault({
    filePath: path.join(root, "vault.json"),
    encryption: {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(`secure:${value}`),
      decryptString: (value) => value.toString().slice("secure:".length),
    },
  });
};

const makeHarness = Effect.gen(function* () {
  const vault = makeVault();
  const send = vi.fn();
  let url = "https://example.com/login?private=1";
  const guest = { id: 42, getURL: () => url, isDestroyed: () => false, send };
  const runtime = yield* makeBrowserCredentialRuntime({
    vault,
    resolveGuest: (candidate) => (candidate.browserTabId === identity.browserTabId ? guest : null),
    resolveGuestIdentity: (guestId) => (guestId === 42 ? identity : null),
    resolveGuestOwner: (guestId) => (guestId === 42 ? 7 : null),
    now: () => 1_000,
  });
  return {
    runtime,
    send,
    setUrl: (value: string) => {
      url = value;
    },
    vault,
  };
});

it.effect("treats an unattached Browser page as having no site credentials", () =>
  Effect.gen(function* () {
    const vault = makeVault();
    vault.save({ origin: "https://example.com", username: "person", password: "top-secret" });
    const runtime = yield* makeBrowserCredentialRuntime({
      vault,
      resolveGuest: () => null,
      resolveGuestIdentity: () => null,
      resolveGuestOwner: () => null,
    });
    assert.deepEqual(yield* runtime.listForTab(identity), []);
  }),
);

it.effect("keeps candidate plaintext out of renderer events and persists authorized saves", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness;
    const candidate = yield* runtime.captureGuestCandidate(42, {
      username: "person@example.com",
      password: "top-secret",
    });
    assert.deepInclude(candidate, {
      ...identity,
      origin: "https://example.com",
      username: "person@example.com",
    });
    assert.notInclude(JSON.stringify(candidate), "top-secret");
    assert.deepEqual(
      yield* runtime.actOnCandidate(7, {
        candidateId: candidate!.candidateId,
        action: "save",
      }),
      { ok: true },
    );
    assert.lengthOf(yield* runtime.listForTab(identity), 1);
  }),
);

it.effect("sends decrypted fill data only to the exact guest origin", () =>
  Effect.gen(function* () {
    const { runtime, send, setUrl, vault } = yield* makeHarness;
    const summary = vault.save({
      origin: "https://example.com",
      username: "person",
      password: "top-secret",
    });
    assert.deepEqual(yield* runtime.fill({ ...identity, credentialId: summary.id }), { ok: true });
    assert.deepEqual(send.mock.calls[0], [
      "browser-credential-fill",
      {
        origin: "https://example.com",
        username: "person",
        password: "top-secret",
        kind: "saved",
      },
    ]);
    setUrl("https://other.example");
    assert.isFalse((yield* runtime.fill({ ...identity, credentialId: summary.id })).ok);
    assert.lengthOf(send.mock.calls, 1);
  }),
);

it.effect("fills encrypted contact info directly into the exact guest", () =>
  Effect.gen(function* () {
    const { runtime, send } = yield* makeHarness;
    const contact = yield* runtime.saveContactInfo({
      label: "Home",
      fullName: "Example Person",
      email: "person@example.com",
      phone: "+86 123",
      addressLine1: "1 Private Street",
      addressLine2: "",
      city: "Shanghai",
      region: "Shanghai",
      postalCode: "200000",
      country: "China",
    });
    assert.deepEqual(yield* runtime.fillContactInfo({ ...identity, contactInfoId: contact.id }), {
      ok: true,
    });
    assert.deepEqual(send.mock.calls[0], [
      "browser-contact-info-fill",
      {
        origin: "https://example.com",
        contactInfo: {
          addressLine1: "1 Private Street",
          addressLine2: "",
          city: "Shanghai",
          country: "China",
          email: "person@example.com",
          fullName: "Example Person",
          phone: "+86 123",
          postalCode: "200000",
          region: "Shanghai",
        },
      },
    ]);
  }),
);

it.effect("rejects a candidate from another renderer owner and clears candidates on release", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness;
    const candidate = yield* runtime.captureGuestCandidate(42, {
      username: "person",
      password: "top-secret",
    });
    assert.isFalse(
      (yield* runtime.actOnCandidate(8, {
        candidateId: candidate!.candidateId,
        action: "save",
      })).ok,
    );
    yield* runtime.releaseOwner(7);
    assert.isFalse(
      (yield* runtime.actOnCandidate(7, {
        candidateId: candidate!.candidateId,
        action: "save",
      })).ok,
    );
  }),
);

it.effect("does not prompt again when submitted credentials are unchanged", () =>
  Effect.gen(function* () {
    const { runtime, vault } = yield* makeHarness;
    vault.save({ origin: "https://example.com", username: "person", password: "top-secret" });
    assert.isNull(
      yield* runtime.captureGuestCandidate(42, {
        username: "person",
        password: "top-secret",
      }),
    );
  }),
);
