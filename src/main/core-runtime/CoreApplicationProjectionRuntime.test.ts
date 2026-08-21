import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { layer as scopedCallbackRuntimeLive } from "../app/ScopedCallbackRuntime";
import { createCoreLocalCommitFixture } from "../core-client/testing/local-commit-fixture";
import { DatabaseNotifier } from "../local-store/notifier";
import { CoreApplicationProjectionRuntime, live } from "./CoreApplicationProjectionRuntime";

it.effect("projects Automation commits and full resynchronization through owned ports", () =>
  Effect.gen(function* () {
    const notifier = new DatabaseNotifier();
    const scheduledEvents: unknown[] = [];
    const runEvents: unknown[] = [];
    const libraryEvents: unknown[] = [];
    const projectEvents: unknown[] = [];
    const sessionEvents: unknown[] = [];
    let synchronizeCount = 0;
    notifier.on("library-navigation-changed", (event) => libraryEvents.push(event));
    notifier.on("projects-changed", (event) => projectEvents.push(event));
    notifier.on("project-sessions-changed", (event) => sessionEvents.push(event));

    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      live({
        automation: {
          notifyAutomationRunsUpdated: (event) => runEvents.push(event),
          notifyScheduledAutomationChanged: (event) => scheduledEvents.push(event),
          synchronize: Effect.sync(() => {
            synchronizeCount += 1;
          }),
        },
        notifier,
      }).pipe(Layer.provide(scopedCallbackRuntimeLive)),
      scope,
    );
    const runtime = Context.get(context, CoreApplicationProjectionRuntime);
    const packet = createCoreLocalCommitFixture({
      commitSeq: 8,
      storeEpoch: "epoch:test",
      payload: {
        module: "automation",
        library_id: "library-1",
        project_id: "project-1",
        event: {
          kind: "automation_changed",
          automation_ids: ["daily-report"],
          lease_ids: [],
          run_ids: ["thread:daily-report"],
          reminder_lease_ids: [],
          snooze_ids: [],
          page_ids: [],
          document_ids: [],
          database_ids: [],
        },
      },
    });

    runtime.publish({ transport_version: 4, packet }, packet.atoms[0]!, "library-1");
    yield* Effect.yieldNow;

    assert.strictEqual(synchronizeCount, 1);
    assert.deepEqual(scheduledEvents, [
      { automationId: "daily-report", targetThreadId: null, reason: "upsert" },
    ]);
    assert.deepEqual(runEvents, [
      { automationId: "daily-report", threadId: "thread:daily-report", reason: "settle" },
    ]);

    runtime.publishResync({ commitSeq: 9, libraryId: "library-1", storeEpoch: "epoch:test" });
    assert.deepEqual(libraryEvents, [
      {
        version: 1,
        libraryId: "library-1",
        storeEpoch: "epoch:test",
        commitSeq: 9,
        changeKind: "content",
        affectedParentKeys: ["library", "catalog"],
        affectedPageIds: [],
        affectedDatabaseIds: [],
        affectedViewIds: [],
      },
    ]);
    assert.deepEqual(projectEvents, [{ changeType: "update", projectId: undefined }]);
    assert.strictEqual(sessionEvents.length, 1);

    yield* Scope.close(scope, Exit.void);
  }),
);
