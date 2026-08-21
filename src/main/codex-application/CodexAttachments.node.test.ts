import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { CodexAttachments, live } from "./CodexAttachments";

it.effect("exposes pasted-text and goal files through one scoped interface", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "nodex-attachments-effect-")));
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(live(root), scope);
    const attachments = Context.get(context, CodexAttachments);

    const pasted = yield* attachments.createPastedText({ text: "source text" });
    assert.strictEqual(yield* attachments.readPastedText(pasted.file), "source text");
    const goal = yield* attachments.materializeGoal({
      objective: "Ship the change",
      pastedTextAttachments: [pasted],
      imageAttachments: [],
    });
    assert.isString(goal.objective);
    yield* attachments.cleanupMaterializedGoal(goal.attachmentDirectory);
    yield* attachments.removePastedText(pasted.file);

    yield* Scope.close(scope, Exit.void);
    yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
  }),
);
