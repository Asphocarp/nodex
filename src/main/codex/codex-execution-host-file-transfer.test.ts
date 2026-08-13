import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CodexLocalExecutionHostFileTransfer } from "./codex-execution-host-file-transfer";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true });
  }));
});

describe("CodexLocalExecutionHostFileTransfer", () => {
  test("hashes and copies only authorized regular files through private staging", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-handoff-transfer-"));
    roots.push(root);
    const authorized = path.join(root, "authorized");
    const staging = path.join(root, "staging");
    const source = path.join(authorized, "state.bin");
    await mkdir(authorized, { recursive: true });
    await writeFile(source, Buffer.from([0, 1, 2, 3, 255]));
    const transfer = new CodexLocalExecutionHostFileTransfer({
      hostId: "local",
      stagingRoot: staging,
      allowedReadRoots: [authorized],
    });

    const descriptor = await transfer.describe(source);
    expect(descriptor).toMatchObject({ path: source, size: 5 });
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const uploaded = await transfer.upload({
      localPath: source,
      operationId: "operation-1",
      fileName: "state.bin",
      sha256: descriptor.sha256,
      size: descriptor.size,
    });
    expect(await readFile(uploaded.path)).toEqual(Buffer.from([0, 1, 2, 3, 255]));
    await transfer.cleanup("operation-1");
    await expect(readFile(uploaded.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects paths outside the host roots and changed source descriptors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-handoff-transfer-"));
    roots.push(root);
    const authorized = path.join(root, "authorized");
    const source = path.join(authorized, "state.txt");
    const outside = path.join(root, "outside.txt");
    await mkdir(authorized, { recursive: true });
    await writeFile(source, "before");
    await writeFile(outside, "outside");
    const transfer = new CodexLocalExecutionHostFileTransfer({
      hostId: "local",
      stagingRoot: path.join(root, "staging"),
      allowedReadRoots: [authorized],
    });
    const descriptor = await transfer.describe(source);
    await writeFile(source, "after");

    await expect(transfer.describe(outside)).rejects.toThrow("outside the authorized host roots");
    await expect(transfer.download({
      source: descriptor,
      destinationPath: path.join(root, "copy.txt"),
    })).rejects.toThrow("changed before transfer");
  });
});
