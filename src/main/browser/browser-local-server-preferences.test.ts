import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BrowserLocalServerPreferencesStore } from "./browser-local-server-preferences";

const temporaryRoots: string[] = [];

function makePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-local-prefs-"));
  temporaryRoots.push(root);
  return path.join(root, "browser-local-server-preferences.json");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("BrowserLocalServerPreferencesStore", () => {
  test("persists Profile-owned preferences and normalizes expanded projects", () => {
    const filePath = makePath();
    const store = new BrowserLocalServerPreferencesStore(filePath);
    expect(store.snapshot()).toEqual({
      showMode: "online",
      sortMode: "recently-used",
      expandedProjectIds: [],
    });

    store.update({
      showMode: "hidden",
      sortMode: "origin",
      expandedProjectIds: [" alpha ", "alpha", "", "beta"],
    });
    expect(new BrowserLocalServerPreferencesStore(filePath).snapshot()).toEqual({
      showMode: "hidden",
      sortMode: "origin",
      expandedProjectIds: ["alpha", "beta"],
    });
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  test("quarantines malformed state instead of blocking Browser startup", () => {
    const filePath = makePath();
    fs.writeFileSync(filePath, "{broken");

    const store = new BrowserLocalServerPreferencesStore(filePath);
    expect(store.snapshot().showMode).toBe("online");
    expect(
      fs
        .readdirSync(path.dirname(filePath))
        .some((entry) => entry.startsWith("browser-local-server-preferences.json.corrupt-")),
    ).toBe(true);
  });
});
