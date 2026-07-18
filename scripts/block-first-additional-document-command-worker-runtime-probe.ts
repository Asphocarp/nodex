import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlockMutationWriter } from "../src/main/block-mutation-writer";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  parseAdditionalDocumentCommandRequest,
} from "../src/shared/additional-document-commands";
import { createUuidV7FromTimestamp } from "../src/shared/uuid-v7";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const blockIds = {
  templateSource: createUuidV7FromTimestamp(1_784_000_000_000, 1),
  templateBody: createUuidV7FromTimestamp(1_784_000_000_000, 2),
  secondaryCanvas: createUuidV7FromTimestamp(1_784_000_000_000, 3),
} as const;

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_HOME;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-additional-command-worker-"),
  );
  process.env.NODEX_HOME = directory;
  let writer: BlockMutationWriter | undefined;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Additional command worker" });
    const storeEpoch = (
      getDb()
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    closeDatabase();

    writer = new BlockMutationWriter();
    const request = parseAdditionalDocumentCommandRequest({
      version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
      operationId: "worker:template",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "worker:surface",
      actor: { kind: "native-worker-probe" },
      coordination: { kind: "fifo_only" },
      operation: {
        kind: "create_template",
        sourceBlockId: blockIds.templateSource,
        documentId: "document:worker-template",
        displayName: "Worker template",
        initialBlocks: [
          {
            id: blockIds.templateBody,
            type: "paragraph",
            props: {},
            content: [
              {
                type: "text",
                text: "Committed through the worker FIFO",
                styles: {},
              },
            ],
            children: [],
          },
        ],
        placement: { kind: "space" },
      },
    });
    const first = await writer.applyAdditionalDocumentCommand(request);
    invariant(
      first.ok &&
        !first.value.duplicate &&
        first.value.effect.createdBlockIds.join(",") ===
          [blockIds.templateBody, blockIds.templateSource].sort().join(","),
      "Worker did not preserve the additional Document receipt",
    );
    const duplicate = await writer.applyAdditionalDocumentCommand({
      ...request,
      clientSessionId: "worker:lost-response",
      actor: { retry: true },
    });
    invariant(
      duplicate.ok &&
        duplicate.value.duplicate &&
        duplicate.value.semanticHash === first.value.semanticHash &&
        duplicate.value.changeLogSeq === first.value.changeLogSeq,
      "Worker exact retry did not replay the durable receipt",
    );
    const canvas = await writer.applyAdditionalDocumentCommand(
      parseAdditionalDocumentCommandRequest({
        version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
        operationId: "worker:canvas-create",
        projectId: project.id,
        storeEpoch,
        clientSessionId: "worker:surface",
        actor: {},
        coordination: { kind: "fifo_only" },
        operation: {
          kind: "create_canvas_owner",
          scope: "non_primary",
          blockId: blockIds.secondaryCanvas,
          documentId: "document:worker-secondary-canvas",
          displayName: "Sketch",
          placement: { kind: "space" },
        },
      }),
    );
    invariant(
      canvas.ok &&
        canvas.value.effect.createdBlockIds.join(",") ===
          blockIds.secondaryCanvas,
      "Worker did not commit the non-primary Canvas owner",
    );
    await writer.shutdown();
    writer = undefined;

    const persisted = new Database(getDatabasePath());
    persisted.pragma("foreign_keys = ON");
    try {
      const owner = persisted
        .prepare(
          `
          SELECT block.type, document.head_seq, materialization.projected_seq
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN document_materializations materialization
            ON materialization.document_id = document.id
          WHERE block.id = ? AND block.project_id = ?
        `,
        )
        .get(blockIds.templateSource, project.id) as {
        readonly type: string;
        readonly head_seq: number;
        readonly projected_seq: number;
      };
      const receipt = persisted
        .prepare(
          `SELECT outcome, change_log_seq FROM block_mutations WHERE mutation_id = ?`,
        )
        .get(request.operationId) as {
        readonly outcome: string;
        readonly change_log_seq: number;
      };
      const canvasOwner = persisted
        .prepare(
          `
          SELECT block.lifecycle, document.head_seq,
            scene.head_seq AS scene_head_seq
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN canvas_scenes scene ON scene.document_id = document.id
          WHERE block.id = ? AND block.project_id = ?
        `,
        )
        .get(blockIds.secondaryCanvas, project.id) as {
        readonly lifecycle: string;
        readonly head_seq: number;
        readonly scene_head_seq: number;
      };
      const foreignKeys = persisted.pragma(
        "foreign_key_check",
      ) as readonly unknown[];
      invariant(
        owner.type === "reusable_template_source" &&
          owner.head_seq === 1 &&
          owner.projected_seq === owner.head_seq &&
          receipt.outcome === "committed" &&
          receipt.change_log_seq === first.value.changeLogSeq &&
          canvasOwner.lifecycle === "active" &&
          canvasOwner.head_seq === canvasOwner.scene_head_seq &&
          foreignKeys.length === 0,
        "Worker ACK preceded durable owner/projection/receipt state",
      );
      process.stdout.write(
        `${JSON.stringify({
          fifo: true,
          exactRetry: true,
          nonPrimaryCanvas: true,
          projection: true,
          restart: true,
          foreignKeys: true,
        })}\n`,
      );
    } finally {
      persisted.close();
    }
  } finally {
    if (writer) await writer.shutdown().catch(() => undefined);
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_HOME;
    else process.env.NODEX_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
