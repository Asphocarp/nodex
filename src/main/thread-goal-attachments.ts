import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  CodexThreadGoalDraftInput,
  CodexThreadGoalMaterializedDraft,
} from "../shared/types";

const THREAD_GOAL_ATTACHMENTS_DIR = "attachments";
const THREAD_GOAL_OBJECTIVE_FILE = "goal-objective.md";
const THREAD_GOAL_OBJECTIVE_PREFIX = "Read the Codex goal objective file at ";
const THREAD_GOAL_OBJECTIVE_SUFFIX = " before continuing.";
const THREAD_GOAL_INLINE_OBJECTIVE_MAX_CODE_POINTS = 4000;
const THREAD_GOAL_ATTACHMENT_DIRECTORY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getThreadGoalAttachmentsRoot(userDataPath: string): string {
  return join(userDataPath, THREAD_GOAL_ATTACHMENTS_DIR);
}

export async function materializeThreadGoalDraft(input: {
  attachmentsRoot: string;
  draft: CodexThreadGoalDraftInput;
}): Promise<CodexThreadGoalMaterializedDraft> {
  const attachmentsRoot = resolve(input.attachmentsRoot);
  let objective = input.draft.objective.trim();
  let attachmentDirectory: string | null = null;

  const ensureAttachmentDirectory = async () => {
    if (attachmentDirectory !== null) return attachmentDirectory;
    attachmentDirectory = join(attachmentsRoot, randomUUID());
    await mkdir(attachmentDirectory, { recursive: true });
    return attachmentDirectory;
  };

  const writeAttachment = async (attachment: { filename: string; contentsBase64: string }) => {
    const directory = await ensureAttachmentDirectory();
    const filePath = join(directory, attachment.filename);
    await writeFile(filePath, Buffer.from(attachment.contentsBase64, "base64"));
    return filePath;
  };

  try {
    const pastedTextAttachments = (input.draft.pastedTextAttachments ?? []).map((attachment, index) => ({
      filename: `pasted-text-${index + 1}.txt`,
      contentsBase64: Buffer.from(attachment.text, "utf8").toString("base64"),
    }));
    const localImageAttachments: Array<{
      contentsBase64: string;
      filename: string;
      position: number;
    }> = [];
    const remoteImageUrls: Array<{ position: number; url: string }> = [];

    for (const [index, attachment] of (input.draft.imageAttachments ?? []).entries()) {
      const position = index + 1;
      const source = attachment.source.trim();
      if (!source) continue;
      if (isRemoteImageUrl(source)) {
        remoteImageUrls.push({ position, url: source });
        continue;
      }
      localImageAttachments.push({
        contentsBase64: await readImageAttachmentBase64(attachment),
        filename: `image-${position}.${inferImageAttachmentExtension(attachment)}`,
        position,
      });
    }

    if (
      objective.length === 0 &&
      pastedTextAttachments.length === 0 &&
      localImageAttachments.length === 0 &&
      remoteImageUrls.length === 0
    ) {
      throw new Error("Goal objective must not be empty");
    }

    const pastedTextReferences: string[] = [];
    for (const attachment of pastedTextAttachments) {
      const filePath = await writeAttachment(attachment);
      pastedTextReferences.push(`- pasted text file: ${filePath}. Read this file before continuing.`);
    }
    objective = appendThreadGoalReferenceSection(
      objective,
      "Referenced pasted text files:",
      pastedTextReferences,
    );

    const imageFileReferences: string[] = [];
    for (const attachment of localImageAttachments) {
      const filePath = await writeAttachment(attachment);
      imageFileReferences.push(`- [Image #${attachment.position}]: ${filePath}`);
    }
    objective = appendThreadGoalReferenceSection(objective, "Referenced image files:", imageFileReferences);
    objective = appendThreadGoalReferenceSection(
      objective,
      "Referenced image URLs:",
      remoteImageUrls.map((attachment) => `- [Image #${attachment.position}]: ${attachment.url}`),
    );

    if (Array.from(objective).length <= THREAD_GOAL_INLINE_OBJECTIVE_MAX_CODE_POINTS) {
      return { objective, attachmentDirectory };
    }

    const fileReference = buildThreadGoalObjectiveFileReference(
      join(await ensureAttachmentDirectory(), THREAD_GOAL_OBJECTIVE_FILE),
    );
    await writeAttachment({
      filename: THREAD_GOAL_OBJECTIVE_FILE,
      contentsBase64: Buffer.from(objective, "utf8").toString("base64"),
    });
    return {
      objective: fileReference,
      attachmentDirectory,
    };
  } catch (error) {
    if (attachmentDirectory !== null) {
      await removeOwnedThreadGoalAttachmentDirectory(attachmentDirectory, attachmentsRoot);
    }
    throw error;
  }
}

export async function removeOwnedThreadGoalAttachmentDirectory(
  directoryPath: string | null | undefined,
  attachmentsRoot?: string,
): Promise<void> {
  if (!directoryPath) return;
  assertOwnedThreadGoalAttachmentDirectory(directoryPath, attachmentsRoot);
  await rm(directoryPath, { recursive: true, force: true }).catch(() => undefined);
}

export async function readThreadGoalEditableObjective(input: {
  attachmentsRoot: string;
  objective: string;
}): Promise<string> {
  const filePath = parseThreadGoalObjectiveFileReference(input.objective);
  if (filePath === null) return input.objective;
  if (!isOwnedThreadGoalObjectiveFilePath(input.attachmentsRoot, filePath)) return input.objective;
  return await readFile(filePath, "utf8");
}

export function parseThreadGoalObjectiveFileReference(objective: string): string | null {
  if (!objective.startsWith(THREAD_GOAL_OBJECTIVE_PREFIX)) return null;
  if (!objective.endsWith(THREAD_GOAL_OBJECTIVE_SUFFIX)) return null;
  const filePath = objective.slice(
    THREAD_GOAL_OBJECTIVE_PREFIX.length,
    -THREAD_GOAL_OBJECTIVE_SUFFIX.length,
  );
  return filePath.length > 0 ? filePath : null;
}

function appendThreadGoalReferenceSection(objective: string, heading: string, lines: readonly string[]): string {
  if (lines.length === 0) return objective;
  return `${objective.length > 0 ? `${objective}\n\n` : ""}${heading}\n${lines.join("\n")}`;
}

function buildThreadGoalObjectiveFileReference(filePath: string): string {
  const reference = `${THREAD_GOAL_OBJECTIVE_PREFIX}${filePath}${THREAD_GOAL_OBJECTIVE_SUFFIX}`;
  if (Array.from(reference).length > THREAD_GOAL_INLINE_OBJECTIVE_MAX_CODE_POINTS) {
    throw new Error(
      `Goal objective file reference exceeds ${THREAD_GOAL_INLINE_OBJECTIVE_MAX_CODE_POINTS} characters`,
    );
  }
  return reference;
}

function isRemoteImageUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

async function readImageAttachmentBase64(attachment: NonNullable<CodexThreadGoalDraftInput["imageAttachments"]>[number]): Promise<string> {
  const dataUrlMatch = attachment.source.match(/^data:[^,]*?(;base64)?,(.*)$/is);
  if (dataUrlMatch) {
    if (dataUrlMatch[1] === undefined) {
      return Buffer.from(decodeURIComponent(dataUrlMatch[2] ?? ""), "utf8").toString("base64");
    }
    return dataUrlMatch[2] ?? "";
  }

  const rawPath = attachment.localPath ?? attachment.source.replace(/^file:\/\//i, "");
  const filePath = attachment.localPath === undefined || attachment.localPath === null
    ? decodeURIComponent(rawPath)
    : rawPath;
  const bytes = await readFile(filePath);
  return bytes.toString("base64");
}

function inferImageAttachmentExtension(
  attachment: NonNullable<CodexThreadGoalDraftInput["imageAttachments"]>[number],
): string {
  const namedExtension = (attachment.filename ?? attachment.localPath ?? "").match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (namedExtension) return namedExtension.toLowerCase();

  const mimeExtension = attachment.source.match(/^data:image\/([a-z0-9.+-]+);/i)?.[1];
  if (mimeExtension === "jpeg") return "jpg";
  return mimeExtension?.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "png";
}

function assertOwnedThreadGoalAttachmentDirectory(directoryPath: string, attachmentsRoot?: string): void {
  const resolved = resolve(directoryPath);
  if (!THREAD_GOAL_ATTACHMENT_DIRECTORY_PATTERN.test(basename(resolved))) {
    throw new Error("Thread goal attachment directory is not owned by Nodex");
  }
  if (attachmentsRoot !== undefined && dirname(resolved) !== resolve(attachmentsRoot)) {
    throw new Error("Thread goal attachment directory is outside the attachments root");
  }
  if (basename(dirname(resolved)) !== THREAD_GOAL_ATTACHMENTS_DIR) {
    throw new Error("Thread goal attachment directory is outside the attachments root");
  }
}

function isOwnedThreadGoalObjectiveFilePath(attachmentsRoot: string, filePath: string): boolean {
  const resolvedRoot = resolve(attachmentsRoot);
  const resolvedFilePath = resolve(filePath);
  const directoryName = basename(dirname(resolvedFilePath));
  if (!THREAD_GOAL_ATTACHMENT_DIRECTORY_PATTERN.test(directoryName)) return false;
  return resolvedFilePath === join(resolvedRoot, directoryName, THREAD_GOAL_OBJECTIVE_FILE);
}
