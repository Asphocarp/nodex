import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { ProjectAppearanceSchema } from "../../shared/schemas/projects";

const JOURNAL_FILE_NAME = "initial-project-v2.json";
const JOURNAL_MAX_BYTES = 64 * 1024;

const InitialProjectStarterPageSchema = z.object({
  pageId: z.string().uuid(),
  documentId: z.string().uuid(),
  titleMarkdown: z.string().min(1).max(10_000),
  nfm: z.string().max(48 * 1024),
}).strict();

const InitialProjectPayloadSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(256),
  description: z.string().max(100_000),
  appearance: ProjectAppearanceSchema,
  sources: z.array(z.string().min(1).max(4_096)).length(1),
  starterPage: InitialProjectStarterPageSchema,
}).strict();

const InitialProjectJournalSchema = z.object({
  schemaVersion: z.literal(2),
  attemptId: z.string().uuid(),
  operationId: z.string().uuid(),
  payload: InitialProjectPayloadSchema,
}).strict();

export type InitialProjectJournal = z.infer<
  typeof InitialProjectJournalSchema
>;

interface InitialProjectRecoveryJournalOptions {
  readonly filePath: string;
  readonly now?: () => number;
}

export class InitialProjectRecoveryJournal {
  private readonly now: () => number;
  private writeTail = Promise.resolve();

  constructor(private readonly options: InitialProjectRecoveryJournalOptions) {
    this.now = options.now ?? Date.now;
  }

  async load(): Promise<InitialProjectJournal | null> {
    try {
      const metadata = await lstat(this.options.filePath);
      if (
        metadata.isSymbolicLink()
        || !metadata.isFile()
        || metadata.size > JOURNAL_MAX_BYTES
      ) {
        await this.quarantine();
        return null;
      }
      const raw = await readFile(this.options.filePath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > JOURNAL_MAX_BYTES) {
        await this.quarantine();
        return null;
      }
      const parsed = InitialProjectJournalSchema.safeParse(
        JSON.parse(raw) as unknown,
      );
      if (
        !parsed.success
        || parsed.data.payload.sources.some((source) => !isAbsolute(source))
      ) {
        await this.quarantine();
        return null;
      }
      return parsed.data;
    } catch (error) {
      if (isMissingPathError(error)) return null;
      if (error instanceof SyntaxError) {
        await this.quarantine();
        return null;
      }
      throw error;
    }
  }

  async save(journal: InitialProjectJournal): Promise<void> {
    const parsed = InitialProjectJournalSchema.parse(journal);
    if (parsed.payload.sources.some((source) => !isAbsolute(source))) {
      throw new Error("Initial Project journal sources must be absolute");
    }
    await this.enqueueWrite(async () => {
      await writeDurableJson(this.options.filePath, parsed, JOURNAL_MAX_BYTES);
    });
  }

  async clear(): Promise<void> {
    await this.enqueueWrite(async () => {
      await rm(this.options.filePath, { force: true });
      await syncDirectory(dirname(this.options.filePath));
    });
  }

  private async quarantine(): Promise<void> {
    const target = `${this.options.filePath}.corrupt-${this.now()}`;
    try {
      await rename(this.options.filePath, target);
      await syncDirectory(dirname(this.options.filePath));
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.catch(() => undefined);
    await result;
  }
}

export async function writeDurableJson(
  filePath: string,
  value: unknown,
  maxBytes: number,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > maxBytes) {
    throw new Error("Durable JSON payload exceeds its size limit");
  }
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    await syncDirectory(dirname(filePath));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

export function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

export function resolveInitialProjectJournalPath(nodexHome: string): string {
  return join(nodexHome, "recovery", JOURNAL_FILE_NAME);
}
