import { afterEach, describe, expect, test } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { CodexPromptTextAttachmentInput } from "../shared/types";
import { COMPOSER_PASTED_TEXT_MAX_BYTES } from "../shared/pasted-text-attachments";
import {
  getThreadGoalAttachmentsRoot,
  parseThreadGoalObjectiveFileReference,
  PastedTextAttachmentManager,
  readThreadGoalEditableObjective,
  ThreadGoalAttachmentDirectoryManager,
} from "./thread-goal-attachments";

const tempRoots: string[] = [];

async function createTempGoalRoot(): Promise<string> {
  const userDataRoot = await mkdtemp(join(tmpdir(), "nodex-goal-attachments-"));
  tempRoots.push(userDataRoot);
  return getThreadGoalAttachmentsRoot(userDataRoot);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("thread goal attachment materialization", () => {
  test("accepts the exact UTF-8 paste limit and reads only registry-owned sources", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new PastedTextAttachmentManager({ attachmentsRoot });
    const exactText = "é".repeat(COMPOSER_PASTED_TEXT_MAX_BYTES / 2);
    const attachment = await manager.createRawSource({ text: exactText });

    expect(await manager.readRawSource(attachment.file)).toBe(exactText);
    await expect(
      manager.readRawSource({
        label: "outside",
        path: join(dirname(attachmentsRoot), "outside.txt"),
        fsPath: join(dirname(attachmentsRoot), "outside.txt"),
      }),
    ).rejects.toThrow("Unknown pasted text attachment");
  });

  test("rejects one UTF-8 byte over the paste limit before writing", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new PastedTextAttachmentManager({ attachmentsRoot });
    const oversizedText = `${"é".repeat(COMPOSER_PASTED_TEXT_MAX_BYTES / 2)}a`;

    await expect(manager.createRawSource({ text: oversizedText })).rejects.toThrow(
      "Pasted text must be 10 MB or smaller.",
    );
    expect(await readdir(attachmentsRoot).catch(() => [])).toEqual([]);
  });

  test("materializes each raw pasted source in its own UUID directory with the exact filename and preview", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const longText = `  ${"x".repeat(82)}  `;

    const materialized = await new PastedTextAttachmentManager({
      attachmentsRoot,
    }).materializeSources([
      { text: "  First\n\tpasted   request  ", hostId: "host-1" },
      { text: longText },
    ]);

    expect(materialized.attachments.length).toBe(2);
    expect(materialized.createdAttachmentPaths.length).toBe(2);
    expect(
      dirname(materialized.createdAttachmentPaths[0] ?? "") ===
        dirname(materialized.createdAttachmentPaths[1] ?? ""),
    ).toBe(false);

    const first = materialized.attachments[0];
    const second = materialized.attachments[1];
    expect(first?.file?.label).toBe("Pasted text.txt");
    expect(first?.file?.path).toBe(first?.file?.fsPath);
    expect(first?.file?.hostId).toBe(undefined);
    expect(first?.hostId).toBe("host-1");
    expect(first?.preview).toBe("First pasted request");
    expect(first?.characterCount).toBe("  First\n\tpasted   request  ".length);
    expect(Object.prototype.hasOwnProperty.call(first ?? {}, "text")).toBe(false);
    expect(await readFile(first?.file?.fsPath ?? "", "utf8")).toBe("  First\n\tpasted   request  ");
    expect(second?.preview).toBe(`${"x".repeat(79)}…`);
    expect(second?.characterCount).toBe(longText.length);
    expect(await readFile(second?.file?.fsPath ?? "", "utf8")).toBe(longText);

    for (const attachment of materialized.attachments) {
      const fsPath = attachment.file.fsPath;
      expect(basename(fsPath)).toBe("pasted-text.txt");
      expect(dirname(dirname(fsPath))).toBe(attachmentsRoot);
      expect(/^[0-9a-f-]{36}$/i.test(basename(dirname(fsPath)))).toBe(true);
    }
  });

  test("uses the exact fallback preview without changing whitespace-only source bytes", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const rawText = " \n\t  ";
    const materialized = await new PastedTextAttachmentManager({
      attachmentsRoot,
    }).materializeSources([{ text: rawText }]);

    expect(materialized.attachments[0]?.preview).toBe("Pasted text");
    expect(materialized.attachments[0]?.characterCount).toBe(rawText.length);
    expect(await readFile(materialized.attachments[0]?.file.fsPath ?? "", "utf8")).toBe(rawText);
  });

  test("retains existing file-backed pasted refs without taking ownership of their directory", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const sourcePath = join(attachmentsRoot, "..", "existing-pasted-source.txt");
    await writeFile(sourcePath, "Existing pasted request", "utf8");

    const materialized = await new PastedTextAttachmentManager({
      attachmentsRoot,
    }).materializeSources([
      {
        text: "Existing pasted request",
        characterCount: 777,
        file: {
          label: "source.txt",
          path: "/display/source.txt",
          fsPath: sourcePath,
          startLine: null,
          endLine: 9,
        },
      },
    ]);

    expect(materialized.createdAttachmentPaths.length).toBe(0);
    expect(materialized.attachments[0]?.file.path).toBe("/display/source.txt");
    expect(materialized.attachments[0]?.file.fsPath).toBe(sourcePath);
    expect(materialized.attachments[0]?.file.endLine).toBe(9);
    expect(materialized.attachments[0]?.preview).toBe("Existing pasted request");
    expect(materialized.attachments[0]?.characterCount).toBe(777);
    expect(Object.prototype.hasOwnProperty.call(materialized.attachments[0] ?? {}, "text")).toBe(
      false,
    );
  });

  test("retains an already-materialized pasted wrapper without reintroducing raw text", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const materialized = await new PastedTextAttachmentManager({
      attachmentsRoot,
    }).materializeSources([
      {
        file: {
          label: "Pasted text.txt",
          path: "/attachments/existing/pasted-text.txt",
          fsPath: "/attachments/existing/pasted-text.txt",
        },
        preview: "Frozen request",
        hostId: "local",
        characterCount: 14,
      },
    ]);

    expect(materialized.createdAttachmentPaths.length).toBe(0);
    expect(JSON.stringify(materialized.attachments[0])).toBe(
      JSON.stringify({
        file: {
          label: "Pasted text.txt",
          path: "/attachments/existing/pasted-text.txt",
          fsPath: "/attachments/existing/pasted-text.txt",
        },
        preview: "Frozen request",
        hostId: "local",
        characterCount: 14,
      }),
    );
  });

  test("rolls back every newly-owned pasted source directory when materialization fails", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const malformedAttachment = {
      get text(): string {
        throw new Error("original pasted source failure");
      },
    } as CodexPromptTextAttachmentInput;
    let errorMessage = "";

    try {
      await new PastedTextAttachmentManager({ attachmentsRoot }).materializeSources([
        { text: "Created before failure" },
        malformedAttachment,
      ]);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toBe("original pasted source failure");
    const entries = await readdir(attachmentsRoot, { withFileTypes: true });
    const ownedDirectory = entries.find((entry) => entry.isDirectory());
    expect(ownedDirectory !== undefined).toBe(true);
    expect((await readdir(join(attachmentsRoot, ownedDirectory?.name ?? ""))).length).toBe(0);
    expect(JSON.stringify(await readPastedTextAttachmentRegistry(attachmentsRoot))).toBe(
      JSON.stringify({
        attachmentPaths: [],
        pendingRemovalPaths: [],
        textExcerptsByPath: {},
      }),
    );
  });

  test("keeps short text-only objectives inline without creating an attachment directory", async () => {
    const attachmentsRoot = await createTempGoalRoot();

    const materialized = await new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
    }).materializeDraft({
      objective: "  Ship goal parity  ",
      pastedTextAttachments: [],
      imageAttachments: [],
    });

    expect(materialized.objective).toBe("Ship goal parity");
    expect(materialized.attachmentDirectory).toBe(null);
  });

  test("writes pasted text and local images and preserves remote image URLs as references", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const localImagePath = join(attachmentsRoot, "..", "diagram-source.bin");
    await writeFile(localImagePath, Buffer.from("image-bytes", "utf8"));

    const materialized = await new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
    }).materializeDraft({
      objective: "Use these references",
      pastedTextAttachments: [{ text: "Pasted requirements" }],
      imageAttachments: [
        { src: `file://${encodeURIComponent(localImagePath)}`, filename: "diagram.PNG" },
        { src: "https://example.com/remote.png", filename: "remote.png" },
      ],
    });

    expect(materialized.attachmentDirectory !== null).toBe(true);
    const directory = materialized.attachmentDirectory ?? "";
    const pastedText = await readFile(join(directory, "pasted-text-1.txt"), "utf8");
    const imageText = await readFile(join(directory, "image-1.png"), "utf8");

    expect(pastedText).toBe("Pasted requirements");
    expect(imageText).toBe("image-bytes");
    expect(Boolean(materialized.objective.includes("Referenced pasted text files:"))).toBe(true);
    expect(
      Boolean(
        materialized.objective.includes(
          `- pasted text file: ${join(directory, "pasted-text-1.txt")}. Read this file before continuing.`,
        ),
      ),
    ).toBe(true);
    expect(Boolean(materialized.objective.includes("Referenced image files:"))).toBe(true);
    expect(
      Boolean(materialized.objective.includes(`- [Image #1]: ${join(directory, "image-1.png")}`)),
    ).toBe(true);
    expect(Boolean(materialized.objective.includes("Referenced image URLs:"))).toBe(true);
    expect(
      Boolean(materialized.objective.includes("- [Image #2]: https://example.com/remote.png")),
    ).toBe(true);
  });

  test("copies file-backed pasted source bytes into the materialized goal directory", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const sourcePath = join(attachmentsRoot, "..", "goal-pasted-source.txt");
    await writeFile(sourcePath, "Requirements from the frozen source", "utf8");

    const materialized = await new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
    }).materializeDraft({
      objective: "Use the source",
      pastedTextAttachments: [
        {
          text: "Stale in-memory text must not win",
          preview: "Requirements from the frozen source",
          file: {
            label: "pasted-text.txt",
            path: sourcePath,
            fsPath: sourcePath,
          },
        },
      ],
      imageAttachments: [],
    });

    const directory = materialized.attachmentDirectory ?? "";
    expect(await readFile(join(directory, "pasted-text-1.txt"), "utf8")).toBe(
      "Requirements from the frozen source",
    );
    expect(await readFile(sourcePath, "utf8")).toBe("Requirements from the frozen source");
  });

  test("reads pasted goal sources concurrently while retaining their reference order", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const startedReads: string[] = [];
    let releaseReads!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const manager = new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
      fileSystem: {
        async readFile(path) {
          startedReads.push(path);
          await readGate;
          return Buffer.from(path.endsWith("first.txt") ? "first" : "second", "utf8");
        },
      },
    });
    const materialization = manager.materializeDraft({
      objective: "Use sources",
      pastedTextAttachments: [
        {
          file: { label: "first", path: "/first.txt", fsPath: "/first.txt" },
          preview: "first",
        },
        {
          file: { label: "second", path: "/second.txt", fsPath: "/second.txt" },
          preview: "second",
        },
      ],
      imageAttachments: [],
    });

    await Promise.resolve();
    expect(startedReads.join(",")).toBe("/first.txt,/second.txt");
    releaseReads();
    const materialized = await materialization;
    expect(
      await readFile(join(materialized.attachmentDirectory ?? "", "pasted-text-1.txt"), "utf8"),
    ).toBe("first");
    expect(
      await readFile(join(materialized.attachmentDirectory ?? "", "pasted-text-2.txt"), "utf8"),
    ).toBe("second");
  });

  test("stores long objectives in goal-objective.md and loads them for editing", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const longObjective = "x".repeat(4001);

    const materialized = await new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
    }).materializeDraft({
      objective: longObjective,
      pastedTextAttachments: [],
      imageAttachments: [],
    });

    const objectiveFilePath = parseThreadGoalObjectiveFileReference(materialized.objective);
    expect(objectiveFilePath !== null).toBe(true);
    expect(Boolean(objectiveFilePath?.endsWith("goal-objective.md"))).toBe(true);
    expect(await readFile(objectiveFilePath ?? "", "utf8")).toBe(longObjective);
    expect(
      await readThreadGoalEditableObjective({ attachmentsRoot, objective: materialized.objective }),
    ).toBe(longObjective);
    expect(
      await readThreadGoalEditableObjective({
        attachmentsRoot,
        objective:
          "Read the Codex goal objective file at /tmp/not-owned/goal-objective.md before continuing.",
      }),
    ).toBe(
      "Read the Codex goal objective file at /tmp/not-owned/goal-objective.md before continuing.",
    );
  });

  test("removes owned materialized directories", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new ThreadGoalAttachmentDirectoryManager({ attachmentsRoot });
    const materialized = await manager.materializeDraft({
      objective: "",
      pastedTextAttachments: [{ text: "Temporary" }],
      imageAttachments: [],
    });
    const directory = materialized.attachmentDirectory ?? "";

    await manager.removeDirectory(directory);

    const directoryStat = await stat(directory).catch(() => null);
    expect(directoryStat === null).toBe(true);

    let rejectedOutsideRoot = false;
    try {
      await manager.removeDirectory("/tmp/attachments/550e8400-e29b-41d4-a716-446655440000");
    } catch {
      rejectedOutsideRoot = true;
    }
    expect(rejectedOutsideRoot).toBe(true);
  });
});

describe("managed pasted text attachment lifecycle", () => {
  test("persists raw source ownership and reloads excerpts before removing only the file", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new PastedTextAttachmentManager({ attachmentsRoot });
    const rawText = `  first line\n${"x".repeat(2100)}  `;
    const attachment = await manager.createRawSource({
      text: rawText,
      hostId: "local",
    });

    expect(attachment.file.label).toBe("Pasted text.txt");
    expect(attachment.file.path).toBe(attachment.file.fsPath);
    expect(attachment.preview).toBe(`${"first line ".padEnd(79, "x")}…`);
    expect(attachment.characterCount).toBe(rawText.length);
    expect(attachment.hostId).toBe("local");
    expect(await readFile(attachment.file.fsPath, "utf8")).toBe(rawText);

    const registry = await readPastedTextAttachmentRegistry(attachmentsRoot);
    expect(JSON.stringify(registry.attachmentPaths)).toBe(JSON.stringify([attachment.file.path]));
    expect(JSON.stringify(registry.pendingRemovalPaths)).toBe(JSON.stringify([]));
    expect(registry.textExcerptsByPath[attachment.file.path]).toBe(rawText.trim().slice(0, 2000));

    const reloaded = new PastedTextAttachmentManager({ attachmentsRoot });
    expect(JSON.stringify(await reloaded.getTextExcerpts([attachment.file]))).toBe(
      JSON.stringify([rawText.trim().slice(0, 2000)]),
    );
    await reloaded.remove(attachment.file.path);

    expect((await stat(attachment.file.path).catch(() => null)) === null).toBe(true);
    expect((await stat(dirname(attachment.file.path))).isDirectory()).toBe(true);
    expect(JSON.stringify(await readPastedTextAttachmentRegistry(attachmentsRoot))).toBe(
      JSON.stringify({
        attachmentPaths: [],
        pendingRemovalPaths: [],
        textExcerptsByPath: {},
      }),
    );
  });

  test("retains failed removals in the registry and retries them after reload", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    let rejectRemoval = true;
    const manager = new PastedTextAttachmentManager({
      attachmentsRoot,
      fileSystem: {
        async removeFile(path) {
          if (rejectRemoval) throw new Error("simulated remove failure");
          await rm(path, { force: true });
        },
      },
    });
    const attachment = await manager.createRawSource({ text: "retry me" });
    let removalError = "";
    try {
      await manager.remove(attachment.file.path);
    } catch (error) {
      removalError = error instanceof Error ? error.message : String(error);
    }

    expect(removalError).toBe("simulated remove failure");
    const pendingRegistry = await readPastedTextAttachmentRegistry(attachmentsRoot);
    expect(JSON.stringify(pendingRegistry.pendingRemovalPaths)).toBe(
      JSON.stringify([attachment.file.path]),
    );
    expect((await stat(attachment.file.path)).isFile()).toBe(true);

    rejectRemoval = false;
    const reloaded = new PastedTextAttachmentManager({
      attachmentsRoot,
      fileSystem: {
        async removeFile(path) {
          if (rejectRemoval) throw new Error("simulated remove failure");
          await rm(path, { force: true });
        },
      },
    });
    await reloaded.cleanupPendingRemovals();

    expect((await stat(attachment.file.path).catch(() => null)) === null).toBe(true);
    expect(JSON.stringify(await readPastedTextAttachmentRegistry(attachmentsRoot))).toBe(
      JSON.stringify({
        attachmentPaths: [],
        pendingRemovalPaths: [],
        textExcerptsByPath: {},
      }),
    );
  });

  test("ignores existing unmanaged refs even when their path has the managed shape", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const unmanagedPath = join(
      attachmentsRoot,
      "550e8400-e29b-41d4-a716-446655440000",
      "pasted-text.txt",
    );
    await mkdir(dirname(unmanagedPath), { recursive: true });
    await writeFile(unmanagedPath, "unmanaged", "utf8");

    const manager = new PastedTextAttachmentManager({ attachmentsRoot });
    await manager.remove(unmanagedPath);

    expect(await readFile(unmanagedPath, "utf8")).toBe("unmanaged");
    expect(
      (await stat(join(attachmentsRoot, "pasted-text-attachments.json")).catch(() => null)) ===
        null,
    ).toBe(true);
  });

  test("reports only sources created by the current freeze for allocation rollback", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new PastedTextAttachmentManager({ attachmentsRoot });
    const composerOwned = await manager.createRawSource({ text: "already owned by composer" });

    const frozen = await manager.materializeSources([
      composerOwned,
      { text: "created while freezing pending input" },
    ]);

    expect(frozen.attachments.length).toBe(2);
    expect(JSON.stringify(frozen.createdAttachmentPaths)).toBe(
      JSON.stringify([frozen.attachments[1]?.file.path]),
    );
    expect(frozen.createdAttachmentPaths.includes(composerOwned.file.path)).toBe(false);

    await Promise.allSettled(frozen.createdAttachmentPaths.map((path) => manager.remove(path)));
    expect(await readFile(composerOwned.file.path, "utf8")).toBe("already owned by composer");
    expect((await stat(frozen.attachments[1]?.file.path ?? "").catch(() => null)) === null).toBe(
      true,
    );
  });

  test("filters outside and malformed managed paths while rejecting malformed registry data", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const validPath = join(
      attachmentsRoot,
      "550e8400-e29b-41d4-a716-446655440000",
      "pasted-text.txt",
    );
    const outsidePath = join(dirname(attachmentsRoot), "outside.txt");
    const wrongVersionPath = join(
      attachmentsRoot,
      "550e8400-e29b-11d4-a716-446655440000",
      "pasted-text.txt",
    );
    await mkdir(dirname(validPath), { recursive: true });
    await writeFile(validPath, "valid", "utf8");
    await writeFile(outsidePath, "outside", "utf8");
    await writeFile(
      join(attachmentsRoot, "pasted-text-attachments.json"),
      JSON.stringify({
        attachmentPaths: [validPath, outsidePath, wrongVersionPath],
        pendingRemovalPaths: [outsidePath, wrongVersionPath],
        textExcerptsByPath: {
          [validPath]: "valid excerpt",
          [outsidePath]: "outside excerpt",
          [wrongVersionPath]: "wrong version excerpt",
        },
      }),
      "utf8",
    );

    const manager = new PastedTextAttachmentManager({ attachmentsRoot });
    expect(
      JSON.stringify(
        await manager.getTextExcerpts([
          { label: "valid", path: validPath, fsPath: validPath },
          { label: "outside", path: outsidePath, fsPath: outsidePath },
          { label: "wrong", path: wrongVersionPath, fsPath: wrongVersionPath },
        ]),
      ),
    ).toBe(JSON.stringify(["valid excerpt"]));
    await manager.remove(outsidePath);
    expect(await readFile(outsidePath, "utf8")).toBe("outside");

    const malformedRoot = await createTempGoalRoot();
    await mkdir(malformedRoot, { recursive: true });
    await writeFile(
      join(malformedRoot, "pasted-text-attachments.json"),
      JSON.stringify({ attachmentPaths: "not-an-array", pendingRemovalPaths: [] }),
      "utf8",
    );
    let malformedError = "";
    try {
      await new PastedTextAttachmentManager({ attachmentsRoot: malformedRoot }).getTextExcerpts([
        { label: "x", path: "x", fsPath: "x" },
      ]);
    } catch (error) {
      malformedError = error instanceof Error ? error.message : String(error);
    }
    expect(malformedError).toBe("Invalid pasted text attachment registry");
  });

  test("rolls a created file back when registry persistence fails", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new PastedTextAttachmentManager({
      attachmentsRoot,
      fileSystem: {
        async writeFile(path, data) {
          if (basename(path) === "pasted-text-attachments.json") {
            throw new Error("registry unavailable");
          }
          await writeFile(path, data);
        },
      },
    });
    let createError = "";
    try {
      await manager.createRawSource({ text: "must roll back" });
    } catch (error) {
      createError = error instanceof Error ? error.message : String(error);
    }

    expect(createError).toBe("registry unavailable");
    const entries = await readdir(attachmentsRoot, { withFileTypes: true });
    expect(entries.length).toBe(1);
    expect(entries[0]?.isDirectory()).toBe(true);
    expect((await readdir(join(attachmentsRoot, entries[0]?.name ?? ""))).length).toBe(0);
  });

  test("serializes concurrent registry writes without losing either owned path", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    let activeRegistryWrites = 0;
    let maximumActiveRegistryWrites = 0;
    const manager = new PastedTextAttachmentManager({
      attachmentsRoot,
      fileSystem: {
        async writeFile(path, data) {
          if (basename(path) === "pasted-text-attachments.json") {
            activeRegistryWrites += 1;
            maximumActiveRegistryWrites = Math.max(
              maximumActiveRegistryWrites,
              activeRegistryWrites,
            );
            await Promise.resolve();
            await writeFile(path, data);
            activeRegistryWrites -= 1;
            return;
          }
          await writeFile(path, data);
        },
      },
    });

    const attachments = await Promise.all([
      manager.createRawSource({ text: "first" }),
      manager.createRawSource({ text: "second" }),
    ]);
    const registry = await readPastedTextAttachmentRegistry(attachmentsRoot);

    expect(maximumActiveRegistryWrites).toBe(1);
    expect(registry.attachmentPaths.length).toBe(2);
    expect(registry.attachmentPaths.includes(attachments[0]?.file.path ?? "")).toBe(true);
    expect(registry.attachmentPaths.includes(attachments[1]?.file.path ?? "")).toBe(true);
  });

  test("cleans goal pasted sources with allSettled semantics and never takes unmanaged ownership", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    let rejectedPath: string | null = null;
    const manager = new PastedTextAttachmentManager({
      attachmentsRoot,
      fileSystem: {
        async removeFile(path) {
          if (path === rejectedPath) throw new Error("one source remains pending");
          await rm(path, { force: true });
        },
      },
    });
    const first = await manager.createRawSource({ text: "first" });
    const second = await manager.createRawSource({ text: "second" });
    rejectedPath = first.file.path;
    const unmanagedPath = join(dirname(attachmentsRoot), "unmanaged-goal-source.txt");
    await writeFile(unmanagedPath, "unmanaged", "utf8");

    await manager.cleanupGoalSources({
      objective: "cleanup",
      pastedTextAttachments: [
        first,
        second,
        {
          file: { label: "unmanaged", path: unmanagedPath, fsPath: unmanagedPath },
          preview: "unmanaged",
        },
      ],
      imageAttachments: [],
    });

    expect((await stat(first.file.path)).isFile()).toBe(true);
    expect((await stat(second.file.path).catch(() => null)) === null).toBe(true);
    expect(await readFile(unmanagedPath, "utf8")).toBe("unmanaged");
    const pending = await readPastedTextAttachmentRegistry(attachmentsRoot);
    expect(JSON.stringify(pending.pendingRemovalPaths)).toBe(JSON.stringify([first.file.path]));

    rejectedPath = null;
    await manager.cleanupPendingRemovals();
    expect((await stat(first.file.path).catch(() => null)) === null).toBe(true);
  });
});

describe("owned thread goal attachment directories", () => {
  test("requires in-memory ownership plus an exact root and v4 directory before recursive removal", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
      createUuid: () => "550e8400-e29b-41d4-a716-446655440000",
    });
    const directory = await manager.createDirectory();
    const written = await manager.write({
      contentsBase64: Buffer.from("goal bytes", "utf8").toString("base64"),
      directoryPath: directory.path,
      filename: "../unsafe:name.txt",
    });
    const nestedPath = join(directory.path, "nested", "child.txt");
    await mkdir(dirname(nestedPath), { recursive: true });
    await writeFile(nestedPath, "nested", "utf8");

    expect(written.label).toBe("unsafe_name.txt");
    expect(await readFile(written.path, "utf8")).toBe("goal bytes");
    let unknownError = "";
    try {
      await new ThreadGoalAttachmentDirectoryManager({ attachmentsRoot }).removeDirectory(
        directory.path,
      );
    } catch (error) {
      unknownError = error instanceof Error ? error.message : String(error);
    }
    expect(unknownError).toBe("Unknown thread goal attachment directory");

    await manager.removeDirectory(directory.path);
    expect((await stat(directory.path).catch(() => null)) === null).toBe(true);

    const wrongVersionManager = new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
      createUuid: () => "550e8400-e29b-11d4-a716-446655440000",
    });
    const wrongVersion = await wrongVersionManager.createDirectory();
    let invalidError = "";
    try {
      await wrongVersionManager.write({
        contentsBase64: "",
        directoryPath: wrongVersion.path,
        filename: "x",
      });
    } catch (error) {
      invalidError = error instanceof Error ? error.message : String(error);
    }
    expect(invalidError).toBe("Invalid thread goal attachment directory");

    const outsideRootManager = new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
      createUuid: () => "../550e8400-e29b-41d4-a716-446655440001",
    });
    const outsideRoot = await outsideRootManager.createDirectory();
    let outsideRootError = "";
    try {
      await outsideRootManager.write({
        contentsBase64: "",
        directoryPath: outsideRoot.path,
        filename: "x",
      });
    } catch (error) {
      outsideRootError = error instanceof Error ? error.message : String(error);
    }
    expect(outsideRootError).toBe("Invalid thread goal attachment directory");
  });

  test("accepts raw goal image src and removes a materialized directory only through its owner", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new ThreadGoalAttachmentDirectoryManager({ attachmentsRoot });
    const materialized = await manager.materializeDraft({
      objective: "Use image",
      pastedTextAttachments: [],
      imageAttachments: [
        {
          src: `data:image/png;base64,${Buffer.from("image bytes", "utf8").toString("base64")}`,
          filename: "image.PNG",
        },
      ],
    });
    const directoryPath = materialized.attachmentDirectory ?? "";

    expect(await readFile(join(directoryPath, "image-1.png"), "utf8")).toBe("image bytes");
    expect(
      materialized.objective.includes(`- [Image #1]: ${join(directoryPath, "image-1.png")}`),
    ).toBe(true);
    await manager.removeMaterializedDraft(materialized);
    expect((await stat(directoryPath).catch(() => null)) === null).toBe(true);
  });

  test("uses the exact case-sensitive data URL gate and rejects malformed lowercase data", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const readPaths: string[] = [];
    const manager = new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
      fileSystem: {
        async readFile(path) {
          readPaths.push(path);
          return Buffer.from("uppercase data path", "utf8");
        },
      },
    });
    const uppercase = await manager.materializeDraft({
      objective: "Use image",
      pastedTextAttachments: [],
      imageAttachments: [{ src: "DATA:image/png;base64,aW1hZ2U=" }],
    });

    expect(readPaths.join(",")).toBe("DATA:image/png;base64,aW1hZ2U=");
    expect(await readFile(join(uppercase.attachmentDirectory ?? "", "image-1.png"), "utf8")).toBe(
      "uppercase data path",
    );

    let malformedError = "";
    try {
      await manager.materializeDraft({
        objective: "Use image",
        pastedTextAttachments: [],
        imageAttachments: [{ src: "data:image/png;base64" }],
      });
    } catch (error) {
      malformedError = error instanceof Error ? error.message : String(error);
    }
    expect(malformedError).toBe("Unable to decode goal image");
    expect(readPaths.length).toBe(1);
  });

  test("best-effort removes its owned directory when materialization fails after a partial write", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const manager = new ThreadGoalAttachmentDirectoryManager({
      attachmentsRoot,
      fileSystem: {
        async writeFile(path, data) {
          if (basename(path) === "pasted-text-2.txt") {
            throw new Error("second write failed");
          }
          await writeFile(path, data);
        },
      },
    });
    let materializeError = "";
    try {
      await manager.materializeDraft({
        objective: "Use sources",
        pastedTextAttachments: [{ text: "first" }, { text: "second" }],
        imageAttachments: [],
      });
    } catch (error) {
      materializeError = error instanceof Error ? error.message : String(error);
    }

    expect(materializeError).toBe("second write failed");
    expect((await readdir(attachmentsRoot)).length).toBe(0);
  });
});

async function readPastedTextAttachmentRegistry(attachmentsRoot: string): Promise<{
  attachmentPaths: string[];
  pendingRemovalPaths: string[];
  textExcerptsByPath: Record<string, string>;
}> {
  return JSON.parse(
    await readFile(join(attachmentsRoot, "pasted-text-attachments.json"), "utf8"),
  ) as {
    attachmentPaths: string[];
    pendingRemovalPaths: string[];
    textExcerptsByPath: Record<string, string>;
  };
}
