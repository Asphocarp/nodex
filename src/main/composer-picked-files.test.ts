import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  COMPOSER_PICKED_IMAGE_MAX_BYTES,
  prepareComposerPickedFile,
} from "./composer-picked-files";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nodex-composer-picked-files-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("composer picked files", () => {
  test("embeds image bytes only for selected image files", async () => {
    const dir = await createTempDir();
    const imagePath = path.join(dir, "diagram.png");
    await writeFile(imagePath, Buffer.from("image"));

    const pickedFile = await prepareComposerPickedFile(imagePath);

    expect(pickedFile.label).toBe("diagram.png");
    expect(pickedFile.path).toBe(imagePath);
    expect(pickedFile.bytes).toBe(5);
    expect(pickedFile.mimeType).toBe("image/png");
    expect(pickedFile.imageDataUrl).toBe("data:image/png;base64,aW1hZ2U=");
  });

  test("does not embed bytes for non-image files", async () => {
    const dir = await createTempDir();
    const textPath = path.join(dir, "notes.md");
    await writeFile(textPath, Buffer.from("# notes\n"));

    const pickedFile = await prepareComposerPickedFile(textPath);

    expect(pickedFile.label).toBe("notes.md");
    expect(pickedFile.path).toBe(textPath);
    expect("bytes" in pickedFile).toBeFalse();
    expect("mimeType" in pickedFile).toBeFalse();
    expect("imageDataUrl" in pickedFile).toBeFalse();
  });

  test("does not embed bytes for oversized images", async () => {
    const dir = await createTempDir();
    const imagePath = path.join(dir, "huge.png");
    await writeFile(imagePath, Buffer.alloc(COMPOSER_PICKED_IMAGE_MAX_BYTES + 1));

    const pickedFile = await prepareComposerPickedFile(imagePath);

    expect(pickedFile.label).toBe("huge.png");
    expect("bytes" in pickedFile).toBeFalse();
    expect("imageDataUrl" in pickedFile).toBeFalse();
  });

  test("does not embed bytes for directories with image-like names", async () => {
    const dir = await createTempDir();
    const directoryPath = path.join(dir, "folder.png");
    await mkdir(directoryPath);

    const pickedFile = await prepareComposerPickedFile(directoryPath);

    expect(pickedFile.label).toBe("folder.png");
    expect("bytes" in pickedFile).toBeFalse();
    expect("imageDataUrl" in pickedFile).toBeFalse();
  });
});
