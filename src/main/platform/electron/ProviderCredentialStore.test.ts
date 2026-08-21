import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  ProviderCredentialStore,
  type ProviderCredentialEncryption,
} from "./ProviderCredentialStore";

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
    }),
  };
}

describe("ProviderCredentialStore", () => {
  test("persists only ciphertext and overlays stored keys over inherited environment", () => {
    const { filePath, store } = fixture({
      inheritedEnv: { ANTHROPIC_API_KEY: "inherited-key" },
    });
    store.setApiKey("anthropic", "canary-plaintext-key", "2026-07-21T00:00:00.000Z");

    expect(store.status("anthropic")).toBe("ready");
    expect(store.buildRuntimeEnvOverlay()).toEqual({
      ANTHROPIC_API_KEY: "canary-plaintext-key",
    });
    const serialized = fs.readFileSync(filePath, "utf8");
    expect(serialized).not.toContain("canary-plaintext-key");
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  test("deleting a stored key falls back to inherited status", () => {
    const { store } = fixture({ inheritedEnv: { OPENROUTER_API_KEY: "inherited" } });
    store.setApiKey("openrouter", "stored", "2026-07-21T00:00:00.000Z");
    store.delete("openrouter");

    expect(store.status("openrouter")).toBe("inherited");
    expect(store.buildRuntimeEnvOverlay()).toEqual({});
  });

  test("fails closed when secure storage is unavailable", () => {
    const { store } = fixture({ available: false });
    expect(() => store.setApiKey("moonshotai", "secret", "2026-07-21T00:00:00.000Z")).toThrow(
      "Secure credential storage is unavailable",
    );
    expect(store.status("moonshotai")).toBe("unavailable");
  });

  test("treats OpenAI auth as runtime-managed and rejects unknown providers", () => {
    const { store } = fixture();
    expect(store.status("openai")).toBe("runtimeManaged");
    expect(store.status("unknown")).toBe("unsupported");
    expect(() => store.setApiKey("unknown", "secret", "2026-07-21T00:00:00.000Z")).toThrow(
      "unsupported",
    );
  });
});
