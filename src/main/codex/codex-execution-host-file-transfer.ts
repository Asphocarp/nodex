import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export interface CodexExecutionHostFileDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface CodexExecutionHostFileTransferPort {
  readonly hostId: string;
  describe(
    sourcePath: string,
    signal?: AbortSignal,
  ): Promise<CodexExecutionHostFileDescriptor>;
  download(input: {
    readonly source: CodexExecutionHostFileDescriptor;
    readonly destinationPath: string;
    readonly signal?: AbortSignal;
  }): Promise<CodexExecutionHostFileDescriptor>;
  upload(input: {
    readonly localPath: string;
    readonly operationId: string;
    readonly fileName: string;
    readonly sha256: string;
    readonly size: number;
    readonly signal?: AbortSignal;
  }): Promise<CodexExecutionHostFileDescriptor>;
  cleanup(operationId: string): Promise<void>;
}

const MAX_HANDOFF_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function validateToken(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

export async function describeCodexTransferFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<CodexExecutionHostFileDescriptor> {
  signal?.throwIfAborted();
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Handoff transfer source must be a regular file");
  }
  if (metadata.size > MAX_HANDOFF_FILE_BYTES) {
    throw new Error("Handoff transfer exceeds the 2 GiB safety bound");
  }
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  const abort = () => stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error("Request canceled"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      hash.update(chunk as Buffer);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return { path: filePath, sha256: hash.digest("hex"), size: metadata.size };
}

/** Local implementation used by the same cross-host coordinator as SSH hosts. */
export class CodexLocalExecutionHostFileTransfer implements CodexExecutionHostFileTransferPort {
  readonly hostId: string;
  readonly #stagingRoot: string;
  readonly #allowedReadRoots: readonly string[];

  constructor(options: {
    readonly hostId: string;
    readonly stagingRoot: string;
    readonly allowedReadRoots: readonly string[];
  }) {
    this.hostId = options.hostId.trim();
    this.#stagingRoot = path.resolve(options.stagingRoot);
    this.#allowedReadRoots = options.allowedReadRoots.map((root) => path.resolve(root));
  }

  async describe(
    sourcePath: string,
    signal?: AbortSignal,
  ): Promise<CodexExecutionHostFileDescriptor> {
    this.#assertReadable(sourcePath);
    return await describeCodexTransferFile(sourcePath, signal);
  }

  async download(input: {
    readonly source: CodexExecutionHostFileDescriptor;
    readonly destinationPath: string;
    readonly signal?: AbortSignal;
  }): Promise<CodexExecutionHostFileDescriptor> {
    this.#assertReadable(input.source.path);
    const source = await describeCodexTransferFile(input.source.path, input.signal);
    if (source.sha256 !== input.source.sha256 || source.size !== input.source.size) {
      throw new Error("Handoff source changed before transfer");
    }
    await mkdir(path.dirname(input.destinationPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${input.destinationPath}.${randomUUID()}.tmp`;
    try {
      await pipeline(
        createReadStream(source.path),
        createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
        { signal: input.signal },
      );
      const copied = await describeCodexTransferFile(temporaryPath, input.signal);
      if (copied.sha256 !== source.sha256 || copied.size !== source.size) {
        throw new Error("Handoff transfer failed integrity verification");
      }
      await rename(temporaryPath, input.destinationPath);
      return { ...copied, path: input.destinationPath };
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async upload(input: {
    readonly localPath: string;
    readonly operationId: string;
    readonly fileName: string;
    readonly sha256: string;
    readonly size: number;
    readonly signal?: AbortSignal;
  }): Promise<CodexExecutionHostFileDescriptor> {
    const operationId = validateToken(input.operationId, "handoff operation id");
    const fileName = validateToken(input.fileName, "handoff file name");
    const target = path.join(this.#stagingRoot, operationId, fileName);
    return await this.download({
      source: { path: input.localPath, sha256: input.sha256, size: input.size },
      destinationPath: target,
      signal: input.signal,
    });
  }

  async cleanup(operationId: string): Promise<void> {
    const token = validateToken(operationId, "handoff operation id");
    await rm(path.join(this.#stagingRoot, token), { recursive: true, force: true });
  }

  #assertReadable(candidatePath: string): void {
    const candidate = path.resolve(candidatePath);
    if (this.#allowedReadRoots.some((root) => {
      const relative = path.relative(root, candidate);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    })) return;
    throw new Error("Handoff transfer source is outside the authorized host roots");
  }
}

export function sanitizeCodexTransferToken(value: string, label: string): string {
  return validateToken(value, label);
}
