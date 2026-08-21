import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";
import { BrowserCredentialService } from "./browser-credential-service";
import { BrowserCredentialVault } from "./browser-credential-vault";

const identity: BrowserSidebarTabIdentity = {
  browserConversationId: "conversation",
  browserViewScopeId: "scope",
  browserTabId: "tab",
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-credential-service-"));
  roots.push(root);
  const vault = new BrowserCredentialVault({
    filePath: path.join(root, "vault.json"),
    encryption: {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(`secure:${value}`),
      decryptString: (value) => value.toString().slice("secure:".length),
    },
  });
  const send = vi.fn();
  let url = "https://example.com/login?private=1";
  const guest = {
    id: 42,
    getURL: () => url,
    isDestroyed: () => false,
    send,
  };
  const service = new BrowserCredentialService({
    vault,
    resolveGuest: (candidate) => (candidate.browserTabId === identity.browserTabId ? guest : null),
    resolveGuestIdentity: (guestId) => (guestId === 42 ? identity : null),
    resolveGuestOwner: (guestId) => (guestId === 42 ? 7 : null),
    now: () => 1_000,
  });
  return {
    guest,
    send,
    service,
    setUrl: (value: string) => {
      url = value;
    },
    vault,
  };
}

function makeDetachedHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-credential-service-"));
  roots.push(root);
  const vault = new BrowserCredentialVault({
    filePath: path.join(root, "vault.json"),
    encryption: {
      isAvailable: () => true,
      encryptString: (value) => Buffer.from(`secure:${value}`),
      decryptString: (value) => value.toString().slice("secure:".length),
    },
  });
  return {
    service: new BrowserCredentialService({
      vault,
      resolveGuest: () => null,
      resolveGuestIdentity: () => null,
      resolveGuestOwner: () => null,
    }),
    vault,
  };
}

describe("BrowserCredentialService", () => {
  test("treats an unattached Browser page as having no site credentials", async () => {
    const { service, vault } = makeDetachedHarness();
    await vault.save({
      origin: "https://example.com",
      username: "person",
      password: "top-secret",
    });

    await expect(service.listForTab(identity)).resolves.toEqual([]);
  });

  test("keeps candidate plaintext out of the renderer-facing event", async () => {
    const { service } = makeHarness();
    const candidate = await service.captureGuestCandidate(42, {
      username: "person@example.com",
      password: "top-secret",
    });

    expect(candidate).toMatchObject({
      ...identity,
      origin: "https://example.com",
      username: "person@example.com",
    });
    expect(JSON.stringify(candidate)).not.toContain("top-secret");
    expect(
      await service.actOnCandidate(7, {
        candidateId: candidate!.candidateId,
        action: "save",
      }),
    ).toEqual({ ok: true });
    expect(await service.listForTab(identity)).toHaveLength(1);
  });

  test("sends decrypted fill data directly to the exact guest origin", async () => {
    const { send, service, setUrl, vault } = makeHarness();
    const summary = await vault.save({
      origin: "https://example.com",
      username: "person",
      password: "top-secret",
    });
    expect(
      await service.fill({
        ...identity,
        credentialId: summary.id,
      }),
    ).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("browser-credential-fill", {
      origin: "https://example.com",
      username: "person",
      password: "top-secret",
      kind: "saved",
    });

    setUrl("https://other.example");
    expect(
      await service.fill({
        ...identity,
        credentialId: summary.id,
      }),
    ).toMatchObject({ ok: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("fills encrypted contact info directly into the exact guest", async () => {
    const { send, service } = makeHarness();
    const contact = await service.saveContactInfo({
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

    expect(
      await service.fillContactInfo({
        ...identity,
        contactInfoId: contact.id,
      }),
    ).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("browser-contact-info-fill", {
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
    });
  });

  test("rejects candidate confirmation from a different renderer owner", async () => {
    const { service } = makeHarness();
    const candidate = await service.captureGuestCandidate(42, {
      username: "person",
      password: "top-secret",
    });
    expect(
      await service.actOnCandidate(8, {
        candidateId: candidate!.candidateId,
        action: "save",
      }),
    ).toMatchObject({ ok: false });
  });

  test("does not prompt again when the submitted credential is unchanged", async () => {
    const { service, vault } = makeHarness();
    await vault.save({
      origin: "https://example.com",
      username: "person",
      password: "top-secret",
    });
    expect(
      await service.captureGuestCandidate(42, {
        username: "person",
        password: "top-secret",
      }),
    ).toBeNull();
  });
});
