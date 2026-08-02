import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { RemoteHostedPipPreferenceStore } from "./remote-hosted-pip-preference-store";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("RemoteHostedPipPreferenceStore", () => {
  test("persists a native resize and fails closed on invalid data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-pip-preference-"));
    temporaryRoots.push(root);
    const filePath = path.join(root, "remote-hosted-pip.json");
    const store = new RemoteHostedPipPreferenceStore(filePath);

    expect(store.readAlwaysHide()).toBe(false);
    expect(store.readMaxDisplaySize()).toBeNull();
    store.writeMaxDisplaySize(312.5);
    store.writeAlwaysHide(true);
    const reloaded = new RemoteHostedPipPreferenceStore(filePath);
    expect(reloaded.readMaxDisplaySize()).toBe(312.5);
    expect(reloaded.readAlwaysHide()).toBe(true);

    fs.writeFileSync(filePath, JSON.stringify({ alwaysHide: "yes", maxDisplaySize: -1 }));
    expect(store.readAlwaysHide()).toBe(false);
    expect(store.readMaxDisplaySize()).toBeNull();
  });
});
