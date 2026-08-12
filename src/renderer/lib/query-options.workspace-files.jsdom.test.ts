import { beforeEach, describe, expect, test } from "vitest";
import { installWindowApi } from "@/test/browser-globals";
import {
  workspaceFileBinaryQueryOptions,
  workspaceFileMetadataQueryOptions,
  workspaceFileTextQueryOptions,
} from "./query-options";

const invokeCalls: unknown[][] = [];

describe("workspace file query options", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        invokeCalls.push([channel, ...args]);
        if (channel === "read-file-metadata") {
          return {
            isFile: true,
            createdAtMs: 1,
            mtimeMs: 2,
            sizeBytes: 3,
            contentKind: "text",
          };
        }
        if (channel === "read-file") return { contents: "text" };
        if (channel === "read-file-binary") {
          return { contentsBase64: "aW1hZ2U=", mimeType: "image/png" };
        }
        return null;
      },
    });
  });

  test("keys exact reads only by host, path, and sampling policy", async () => {
    const metadata = workspaceFileMetadataQueryOptions({
      hostId: "local",
      path: "/tmp/worktree/image.png",
      contentSampleByteLimit: 8_192,
      contentSampleMaxFileBytes: 25_000_000,
    });
    const text = workspaceFileTextQueryOptions({
      hostId: "local",
      path: "/tmp/worktree/image.png",
      maxBytes: 1_500_000,
    });
    const binary = workspaceFileBinaryQueryOptions({
      hostId: "local",
      path: "/tmp/worktree/image.png",
    });

    await metadata.queryFn?.({} as never);
    await text.queryFn?.({} as never);
    await expect(binary.queryFn?.({} as never)).resolves.toEqual({
      contentsBase64: "aW1hZ2U=",
      mimeType: "image/png",
    });

    expect(invokeCalls).toEqual([
      ["read-file-metadata", {
        hostId: "local",
        path: "/tmp/worktree/image.png",
        contentSampleByteLimit: 8_192,
        contentSampleMaxFileBytes: 25_000_000,
      }],
      ["read-file", {
        hostId: "local",
        path: "/tmp/worktree/image.png",
        maxBytes: 1_500_000,
      }],
      ["read-file-binary", {
        hostId: "local",
        path: "/tmp/worktree/image.png",
      }],
    ]);
  });
});
