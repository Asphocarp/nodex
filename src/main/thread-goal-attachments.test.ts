import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getThreadGoalAttachmentsRoot,
  materializeThreadGoalDraft,
  parseThreadGoalObjectiveFileReference,
  readThreadGoalEditableObjective,
  removeOwnedThreadGoalAttachmentDirectory,
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
  test("keeps short text-only objectives inline without creating an attachment directory", async () => {
    const attachmentsRoot = await createTempGoalRoot();

    const materialized = await materializeThreadGoalDraft({
      attachmentsRoot,
      draft: {
        objective: "  Ship goal parity  ",
      },
    });

    expect(materialized.objective).toBe("Ship goal parity");
    expect(materialized.attachmentDirectory).toBe(null);
  });

  test("writes pasted text and local images and preserves remote image URLs as references", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const localImagePath = join(attachmentsRoot, "..", "diagram-source.bin");
    await writeFile(localImagePath, Buffer.from("image-bytes", "utf8"));

    const materialized = await materializeThreadGoalDraft({
      attachmentsRoot,
      draft: {
        objective: "Use these references",
        pastedTextAttachments: [{ text: "Pasted requirements" }],
        imageAttachments: [
          { source: `file://${encodeURIComponent(localImagePath)}`, filename: "diagram.PNG" },
          { source: "https://example.com/remote.png", filename: "remote.png" },
        ],
      },
    });

    expect(materialized.attachmentDirectory !== null).toBeTrue();
    const directory = materialized.attachmentDirectory ?? "";
    const pastedText = await readFile(join(directory, "pasted-text-1.txt"), "utf8");
    const imageText = await readFile(join(directory, "image-1.png"), "utf8");

    expect(pastedText).toBe("Pasted requirements");
    expect(imageText).toBe("image-bytes");
    expect(Boolean(materialized.objective.includes("Referenced pasted text files:"))).toBeTrue();
    expect(Boolean(materialized.objective.includes(`- pasted text file: ${join(directory, "pasted-text-1.txt")}. Read this file before continuing.`))).toBeTrue();
    expect(Boolean(materialized.objective.includes("Referenced image files:"))).toBeTrue();
    expect(Boolean(materialized.objective.includes(`- [Image #1]: ${join(directory, "image-1.png")}`))).toBeTrue();
    expect(Boolean(materialized.objective.includes("Referenced image URLs:"))).toBeTrue();
    expect(Boolean(materialized.objective.includes("- [Image #2]: https://example.com/remote.png"))).toBeTrue();
  });

  test("stores long objectives in goal-objective.md and loads them for editing", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const longObjective = "x".repeat(4001);

    const materialized = await materializeThreadGoalDraft({
      attachmentsRoot,
      draft: {
        objective: longObjective,
      },
    });

    const objectiveFilePath = parseThreadGoalObjectiveFileReference(materialized.objective);
    expect(objectiveFilePath !== null).toBeTrue();
    expect(Boolean(objectiveFilePath?.endsWith("goal-objective.md"))).toBeTrue();
    expect(await readFile(objectiveFilePath ?? "", "utf8")).toBe(longObjective);
    expect(await readThreadGoalEditableObjective({ attachmentsRoot, objective: materialized.objective })).toBe(longObjective);
    expect(await readThreadGoalEditableObjective({
      attachmentsRoot,
      objective: "Read the Codex goal objective file at /tmp/not-owned/goal-objective.md before continuing.",
    })).toBe("Read the Codex goal objective file at /tmp/not-owned/goal-objective.md before continuing.");
  });

  test("removes owned materialized directories", async () => {
    const attachmentsRoot = await createTempGoalRoot();
    const materialized = await materializeThreadGoalDraft({
      attachmentsRoot,
      draft: {
        objective: "",
        pastedTextAttachments: [{ text: "Temporary" }],
      },
    });
    const directory = materialized.attachmentDirectory ?? "";

    await removeOwnedThreadGoalAttachmentDirectory(directory);

    const directoryStat = await stat(directory).catch(() => null);
    expect(directoryStat === null).toBeTrue();

    let rejectedOutsideRoot = false;
    try {
      await removeOwnedThreadGoalAttachmentDirectory(
        "/tmp/attachments/550e8400-e29b-41d4-a716-446655440000",
        attachmentsRoot,
      );
    } catch {
      rejectedOutsideRoot = true;
    }
    expect(rejectedOutsideRoot).toBeTrue();
  });
});
