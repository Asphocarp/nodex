import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CardMutationWriter } from "../src/main/card-mutation-writer";
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

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-additional-command-worker-"),
  );
  process.env.NODEX_DIR = directory;
  let writer: CardMutationWriter | undefined;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Additional command worker" });
    const storeEpoch = (
      getDb()
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    closeDatabase();

    writer = new CardMutationWriter();
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
        sourceBlockId: "worker:template-source",
        documentId: "document:worker-template",
        displayName: "Worker template",
        initialBlocks: [
          {
            id: "worker:template-body",
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
          "worker:template-body,worker:template-source",
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
    const gap = await writer.applyAdditionalDocumentCommand(
      parseAdditionalDocumentCommandRequest({
        version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
        operationId: "worker:canvas-gap",
        projectId: project.id,
        storeEpoch,
        clientSessionId: "worker:surface",
        actor: {},
        coordination: { kind: "fifo_only" },
        operation: {
          kind: "create_canvas_owner",
          scope: "non_primary",
          blockId: "worker:secondary-canvas",
          documentId: "document:worker-secondary-canvas",
          displayName: "Sketch",
          placement: { kind: "space" },
        },
      }),
    );
    invariant(
      !gap.ok && gap.error.code === "capability_gap",
      "Worker claimed success for a capability gap",
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
        .get("worker:template-source", project.id) as {
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
      const foreignKeys = persisted.pragma(
        "foreign_key_check",
      ) as readonly unknown[];
      invariant(
        owner.type === "reusable_template_source" &&
          owner.head_seq === 1 &&
          owner.projected_seq === owner.head_seq &&
          receipt.outcome === "committed" &&
          receipt.change_log_seq === first.value.changeLogSeq &&
          foreignKeys.length === 0,
        "Worker ACK preceded durable owner/projection/receipt state",
      );
      process.stdout.write(
        `${JSON.stringify({
          fifo: true,
          exactRetry: true,
          capabilityGap: true,
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
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
