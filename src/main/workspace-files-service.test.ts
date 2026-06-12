import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listWorkspaceDirectoryEntries,
  readWorkspaceFile,
  readWorkspaceFileBinary,
  readWorkspaceFileMetadata,
  readWorkspacePathsExist,
  writeWorkspaceFile,
} from "./workspace-files-service";

const tempRoots: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nodex-workspace-files-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace-files-service", () => {
  test("lists workspace entries with generated folders filtered", async () => {
    const root = await makeTempWorkspace();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "README.md"), "# Project\n", "utf8");

    const result = await listWorkspaceDirectoryEntries({ workspaceRoot: root, includeHidden: true });

    expect(JSON.stringify(result.entries.map((entry) => entry.name))).toBe(JSON.stringify(["src", "README.md"]));
    expect(result.entries[0]?.isDirectory).toBeTrue();
    expect(result.entries[1]?.isFile).toBeTrue();
  });

  test("reads text, binary, metadata, writes files, and checks existence", async () => {
    const root = await makeTempWorkspace();
    const textPath = join(root, "notes.md");
    const binaryPath = join(root, "image.bin");
    await writeFile(textPath, "# Notes\n", "utf8");
    await writeFile(binaryPath, Buffer.from([0, 1, 2, 3]));

    const text = await readWorkspaceFile({ path: textPath });
    const binaryMetadata = await readWorkspaceFileMetadata({ path: binaryPath });
    const binary = await readWorkspaceFileBinary({ path: binaryPath });
    const written = await writeWorkspaceFile({ path: join(root, "nested", "file.txt"), content: "created" });
    const exists = await readWorkspacePathsExist({ paths: [textPath, written.path, join(root, "missing.txt")] });

    expect(text.content).toBe("# Notes\n");
    expect(text.binary).toBeFalse();
    expect(binaryMetadata.binary).toBeTrue();
    expect(binary.dataBase64).toBe("AAECAw==");
    expect(exists.paths[textPath]).toBeTrue();
    expect(exists.paths[written.path]).toBeTrue();
    expect(exists.paths[join(root, "missing.txt")]).toBeFalse();
  });

  test("rejects directory traversal outside the workspace root", async () => {
    const root = await makeTempWorkspace();
    const outside = join(root, "..");

    let message = "";
    try {
      await listWorkspaceDirectoryEntries({ workspaceRoot: root, path: outside });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Workspace path must stay inside the project root");
  });

  test("rejects file reads outside the provided workspace root", async () => {
    const root = await makeTempWorkspace();
    const outsideRoot = await makeTempWorkspace();
    const outsideFile = join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "nope", "utf8");

    let message = "";
    try {
      await readWorkspaceFile({ workspaceRoot: root, path: outsideFile });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Workspace path must stay inside the project root");
  });
});
