import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  ProviderCredentialStore,
  type ProviderCredentialEncryption,
} from "./provider-credential-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createEncryption(available = true): ProviderCredentialEncryption {
  return {
    isAvailable: () => available,
    encryptString: (plaintext) => Buffer.from(`encrypted:${plaintext}`, "utf8"),
    decryptString: (ciphertext) => {
      const value = ciphertext.toString("utf8");
      if (!value.startsWith("encrypted:")) throw new Error("bad ciphertext");
      return value.slice("encrypted:".length);
    },
  };
}

function fixture(input?: { available?: boolean; inheritedEnv?: NodeJS.ProcessEnv }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-provider-credentials-"));
  roots.push(root);
  const filePath = path.join(root, "secrets", "provider-credentials.v1.json");
  return {
    filePath,
    store: new ProviderCredentialStore({
      filePath,
      encryption: createEncryption(input?.available ?? true),
      inheritedEnv: input?.inheritedEnv ?? {},
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    }),
  };
}

describe("ProviderCredentialStore", () => {
  test("persists only ciphertext and overlays stored keys over inherited environment", async () => {
    const { filePath, store } = fixture({
      inheritedEnv: { ANTHROPIC_API_KEY: "inherited-key" },
    });
    await store.setApiKey("anthropic", "canary-plaintext-key");

    expect(await store.status("anthropic")).toBe("ready");
    expect(await store.buildRuntimeEnvOverlay()).toEqual({
      ANTHROPIC_API_KEY: "canary-plaintext-key",
    });
    const serialized = fs.readFileSync(filePath, "utf8");
    expect(serialized).not.toContain("canary-plaintext-key");
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  test("deleting a stored key falls back to inherited status", async () => {
    const { store } = fixture({ inheritedEnv: { OPENROUTER_API_KEY: "inherited" } });
    await store.setApiKey("openrouter", "stored");
    await store.delete("openrouter");

    expect(await store.status("openrouter")).toBe("inherited");
    expect(await store.buildRuntimeEnvOverlay()).toEqual({});
  });

  test("fails closed when secure storage is unavailable", async () => {
    const { store } = fixture({ available: false });
    await expect(store.setApiKey("moonshotai", "secret")).rejects.toThrow(
      "Secure credential storage is unavailable",
    );
    expect(await store.status("moonshotai")).toBe("unavailable");
  });

  test("treats OpenAI auth as runtime-managed and rejects unknown providers", async () => {
    const { store } = fixture();
    expect(await store.status("openai")).toBe("runtimeManaged");
    expect(await store.status("unknown")).toBe("unsupported");
    await expect(store.setApiKey("unknown", "secret")).rejects.toThrow("unsupported");
  });
});
