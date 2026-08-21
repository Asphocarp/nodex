import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import {
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
  type CodexServerRequest,
} from "./CodexApplicationClient";
import { CodexGatewayBridge } from "./CodexGatewayBridge";
import {
  ScopedCallbackRuntime,
  layer as scopedCallbackRuntimeLive,
} from "../app/ScopedCallbackRuntime";
import { CodexApplicationRequestPending } from "../codex-application/ApprovalCoordinator";

it.effect("carries the Effect occurrence token into application request projection", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const callbackContext = yield* Layer.buildWithScope(scopedCallbackRuntimeLive, scope);
    const bridge = new CodexGatewayBridge(Context.get(callbackContext, ScopedCallbackRuntime));
    let received: CodexServerRequest | null = null;
    bridge.setServerRequestHandler((request) => {
      received = request;
      return Promise.resolve(CodexApplicationRequestPending);
    });

    const result = yield* bridge.applicationServerRequests().handle(
      "local",
      4,
      17,
      "item/tool/requestUserInput",
      {
        isBlocking: true,
        itemId: "item-a",
        questions: [],
        threadId: "thread-a",
        turnId: "turn-a",
      },
      23,
    );

    assert.strictEqual(result, CodexApplicationRequestPending);
    assert.strictEqual(received?.[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN], 23);
    yield* Scope.close(scope, Exit.void);
  }),
);
