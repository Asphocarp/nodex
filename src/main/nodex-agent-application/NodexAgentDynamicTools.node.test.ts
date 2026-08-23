import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  CreatePagesV3InputSchema,
  CreatePagesV6OutputSchema,
  type NodexAgentCreatePagesCommand,
} from "../../shared/nodex-agent-tools";
import type { NodexAgentDynamicExecutionContext } from "./NodexAgentDynamicPolicy";
import { NodexAgentApplication } from "./NodexAgentApplication";
import { executeNodexAgentV3Tool } from "./NodexAgentDynamicExecution";

it.effect("authorizes a prepared Page creation before the canonical application commit", () =>
  Effect.gen(function* () {
    const input = CreatePagesV3InputSchema.parse({
      destination: { kind: "library" },
      pages: [{ title: "**Launch** plan", markdown: "## Milestones\n\n- [ ] Ship" }],
    });
    const output = CreatePagesV6OutputSchema.parse({
      data: {
        pages: [
          {
            pageId: "page-created",
            pageKey: null,
            location: { kind: "library", libraryId: "library:agent" },
            bodyBlocksCreated: 2,
          },
        ],
        created: 1,
      },
    });
    const command = {
      threadId: "thread:agent",
      callId: "call:agent",
      projectId: "project:agent",
      requestHash: "request:agent",
      mutationId: "mutation:agent",
      storeEpoch: "epoch:agent",
      input,
      destination: { kind: "library" },
      pages: [],
    } as unknown as NodexAgentCreatePagesCommand;
    const trace: string[] = [];
    let preparationCount = 0;
    const application = NodexAgentApplication.of({
      read: () => Effect.die("unexpected read"),
      completePageUpdate: () => Effect.die("unexpected completion"),
      prepare: (preparation) =>
        Effect.sync(() => {
          assert.strictEqual(preparation.kind, "create_pages");
          preparationCount += 1;
          trace.push("prepare");
          const resourceAccess = preparation.request.resourceAccess;
          return {
            kind: "create_pages" as const,
            value: {
              result: {
                ok: true as const,
                value: {
                  kind: "prepared" as const,
                  command: { ...command, ...(resourceAccess ? { resourceAccess } : {}) },
                  documentHeads: [],
                  previews: [
                    {
                      pageId: "page-created",
                      title: "Launch plan",
                      bodyBlockCount: 2,
                      targetMarkdown: "## Milestones\n\n- [ ] Ship",
                    },
                  ],
                },
              },
              events: [],
              metrics: {
                mutationId: command.mutationId,
                queueWaitMs: 0,
                workerDurationMs: 0,
                transactionMs: 0,
                eventCount: 0,
              },
            },
          };
        }),
      apply: (applicationCommand) =>
        Effect.sync(() => {
          assert.strictEqual(applicationCommand.kind, "create_pages");
          trace.push("apply");
          return {
            kind: "create_pages" as const,
            value: {
              ok: true as const,
              value: {
                output,
                duplicate: false,
                documentCommits: [],
                affectedDatabaseBlockIds: [],
                commitSeq: 1,
              },
            },
          };
        }),
    });
    const authority = {
      threadId: "thread:agent",
      turnId: "turn:agent",
      rootThreadId: "thread:agent",
      actorProjectId: "project:agent",
      libraryId: "library:agent",
      storeEpoch: "epoch:agent",
      scope: "project" as const,
      source: "project_turn" as const,
    };
    const taskGrants: string[] = [];
    const context: NodexAgentDynamicExecutionContext = {
      threadId: authority.threadId,
      callId: "call:agent",
      authority,
      access: {
        read: "allowed",
        write: "consent_required",
        domains: ["document", "placement", "database"],
      },
      resolveResourceAccess: (intents) =>
        Effect.succeed({
          kind: "consent_required" as const,
          requirements: [
            {
              intent: intents[0]!,
              grant: {
                root: { kind: "library" as const, libraryId: authority.libraryId },
                access: "read_write" as const,
                libraryActions: ["create_child" as const],
              },
              reason: "library_consent_required" as const,
              persistable: false,
            },
          ],
          inspectionAccess: {
            kind: "inspection" as const,
            scope: "call" as const,
            threadId: authority.threadId,
            turnId: authority.turnId,
            callId: "call:agent",
            rootThreadId: authority.rootThreadId,
            actorProjectId: authority.actorProjectId,
            libraryId: authority.libraryId,
            storeEpoch: authority.storeEpoch,
            grants: [],
          },
        }),
      authorize: (request) =>
        Effect.sync(() => {
          trace.push("authorize");
          assert.strictEqual(request.tool, "create_pages");
          assert.isTrue(request.preview.markdownPreview?.includes("Milestones"));
          return {
            decision: "allow_task" as const,
            resourceAccess: {
              kind: "consent" as const,
              scope: "task" as const,
              rootThreadId: authority.rootThreadId,
              actorProjectId: authority.actorProjectId,
              libraryId: authority.libraryId,
              storeEpoch: authority.storeEpoch,
              grants: request.requirements.map(({ grant }) => grant),
            },
          };
        }),
      recordTaskResourceAccess: (grants) =>
        Effect.sync(() => {
          taskGrants.push(...grants.map(({ root }) => (root.kind === "page" ? root.pageId : "")));
        }),
    };

    const result = yield* executeNodexAgentV3Tool("create_pages", input, context).pipe(
      Effect.provideService(NodexAgentApplication, application),
    );

    assert.deepEqual(result, output);
    assert.deepEqual(trace, ["prepare", "authorize", "prepare", "apply"]);
    assert.strictEqual(preparationCount, 2);
    assert.deepEqual(taskGrants, ["page-created"]);
  }),
);
