import { describe, expect, test } from "vite-plus/test";
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc, yDocToBlocks } from "@blocknote/core/yjs";
import {
  headlessBlockDocumentSchema,
  type HeadlessBlockDocumentPartialBlock,
} from "./headless-blocknote-schema";

describe("headless Block Document schema", () => {
  test("imports and converts Yjs content in a DOM-free process", () => {
    expect(Reflect.has(globalThis, "document")).toBe(false);
    expect(Reflect.has(globalThis, "window")).toBe(false);

    const editor = BlockNoteEditor.create({
      schema: headlessBlockDocumentSchema,
      initialContent: [
        {
          id: "headless-probe",
          type: "pageRef",
          props: { sourceProjectId: "project-1", cardId: "card-1" },
        },
      ],
    });
    const document = blocksToYDoc(editor, editor.document, "body");
    const decoded = yDocToBlocks(editor, document, "body");

    expect(editor.headless).toBe(true);
    expect(decoded[0]?.id).toBe("headless-probe");
  });

  test("round-trips all custom block and inline shapes through Yjs", () => {
    const initialContent: HeadlessBlockDocumentPartialBlock[] = [
      {
        id: "callout-block",
        type: "callout",
        props: { icon: "📌" },
        content: [
          { type: "text", text: "Before ", styles: { bold: true } },
          {
            type: "attachment",
            props: {
              kind: "file",
              mode: "materialized",
              source: "nodex://assets/example.txt",
              name: "example.txt",
              mimeType: "text/plain",
              bytes: 12,
              origin: "paste",
            },
          },
          {
            type: "agentConfig",
            props: {
              mode: "agent",
              model: "gpt-5",
              reasoning: "high",
              unknownAttributes: "",
              rawAttributes: "mode=agent",
            },
          },
          {
            type: "dateMention",
            props: {
              start: "2026-07-11",
              end: "",
              tz: "Asia/Shanghai",
              format: "date",
              timeFormat: "",
              reminder: "",
            },
          },
          {
            type: "threadMention",
            props: { uuid: "thread-1" },
          },
          { type: "text", text: " after", styles: { italic: true } },
        ],
      },
      {
        id: "card-toggle-block",
        type: "cardToggle",
        props: {
          cardId: "card-1",
          meta: "In progress",
          snapshot: "",
          sourceProjectId: "project-1",
          sourceStatus: "build",
          sourceStatusName: "In progress",
          projectionOwnerId: "",
          projectionKind: "",
          projectionSourceProjectId: "",
          projectionCardId: "",
        },
        content: "Card title",
      },
      {
        id: "thread-section-block",
        type: "threadSection",
        props: { label: "Implementation", threadId: "thread-1" },
      },
      {
        id: "inline-view-block",
        type: "toggleListInlineView",
        props: {
          sourceProjectId: "project-1",
          rulesV2B64: "",
          propertyOrderCsv: "priority,estimate,status",
          hiddenPropertiesCsv: "",
          showEmptyEstimate: "false",
          showEmptyPriority: "true",
        },
      },
      {
        id: "page-block",
        type: "page",
      },
      {
        id: "database-block",
        type: "database",
      },
      {
        id: "canonical-page-ref-block",
        type: "pageRef",
        props: {
          targetBlockId: "card-3",
        },
      },
      {
        id: "database-view-ref-block",
        type: "databaseViewRef",
        props: {
          databaseViewId: "view-1",
          displayHint: "Planning",
        },
      },
      {
        id: "synced-block-ref-block",
        type: "syncedBlockRef",
        props: { sourceBlockId: "synced-source-1" },
      },
      {
        id: "template-ref-block",
        type: "templateRef",
        props: {
          sourceBlockId: "template-source-1",
          displayHint: "Incident review",
        },
      },
    ];
    const editor = BlockNoteEditor.create({
      schema: headlessBlockDocumentSchema,
      initialContent,
    });

    expect(editor.headless).toBe(true);
    const document = blocksToYDoc(editor, editor.document, "body");
    const decoded = yDocToBlocks(editor, document, "body");

    expect(JSON.stringify(decoded)).toBe(JSON.stringify(editor.document));
    expect(decoded.map((block) => block.id).join(",")).toBe(
      "callout-block,card-toggle-block,thread-section-block,inline-view-block,page-block,database-block,canonical-page-ref-block,database-view-ref-block,synced-block-ref-block,template-ref-block",
    );
  });
});
