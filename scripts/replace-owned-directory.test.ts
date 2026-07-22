import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { replaceOwnedDirectory } from "./replace-owned-directory";

const temporaryRoots: string[] = [];

const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-owned-directory-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("replaceOwnedDirectory", () => {
  test("replaces the exact owned closure without touching siblings", () => {
    const root = makeRoot();
    const destination = path.join(root, "bin");
    const source = path.join(root, "staged-bin");
    fs.mkdirSync(destination);
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(destination, "stale-binary"), "stale");
    fs.writeFileSync(path.join(source, "nodex-core"), "current");
    fs.mkdirSync(path.join(root, "agent-runtime"));
    fs.writeFileSync(path.join(root, "agent-runtime", "runtime.json"), "preserved");

    replaceOwnedDirectory(source, destination);

    expect(fs.readdirSync(destination)).toEqual(["nodex-core"]);
    expect(fs.readFileSync(path.join(root, "agent-runtime", "runtime.json"), "utf8"))
      .toBe("preserved");
  });

  test("replaces a symlink entry without modifying its target", () => {
    const root = makeRoot();
    const source = path.join(root, "staged-bin");
    const external = path.join(root, "external-bin");
    const destination = path.join(root, "bin");
    fs.mkdirSync(source);
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(source, "nodex-core"), "current");
    fs.writeFileSync(path.join(external, "preserved"), "external");
    fs.symlinkSync(external, destination);

    replaceOwnedDirectory(source, destination);

    expect(fs.lstatSync(destination).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(destination, "nodex-core"), "utf8")).toBe("current");
    expect(fs.readFileSync(path.join(external, "preserved"), "utf8")).toBe("external");
  });
});
