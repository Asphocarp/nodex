import type {
  WorkspaceFileMetadata,
  WorkspaceFileMetadataInput,
  WorkspaceFileReadResult,
  WorkspaceFileTextReadInput,
} from "./types";

export interface ReadExactWorkspaceTextFileDependencies {
  readonly readMetadata: (input: WorkspaceFileMetadataInput) => Promise<WorkspaceFileMetadata>;
  readonly readText: (input: WorkspaceFileTextReadInput) => Promise<WorkspaceFileReadResult>;
}

export interface ReadExactWorkspaceTextFileInput {
  readonly path: string;
  readonly maxBytes: number;
  readonly contentSampleByteLimit: number;
}

export async function readExactWorkspaceTextFile(
  input: ReadExactWorkspaceTextFileInput,
  dependencies: ReadExactWorkspaceTextFileDependencies,
): Promise<string | null> {
  const metadata = await dependencies.readMetadata({
    path: input.path,
    contentSampleByteLimit: input.contentSampleByteLimit,
    contentSampleMaxFileBytes: input.maxBytes,
  });
  if (
    !metadata.isFile ||
    metadata.contentKind !== "text" ||
    metadata.sizeBytes === null ||
    metadata.sizeBytes > input.maxBytes
  ) {
    return null;
  }

  const result = await dependencies.readText({ path: input.path, maxBytes: input.maxBytes });
  return result.contents;
}
