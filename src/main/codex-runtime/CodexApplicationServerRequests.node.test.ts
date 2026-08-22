import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { assert, it } from "@effect/vitest";
import { CodexApplicationRequestPending } from "../codex-application/ApprovalCoordinator";
import {
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
  type CodexServerRequest,
} from "./CodexApplicationProtocol";
import { makeCodexApplicationServerRequests } from "./CodexApplicationServerRequests";

const input = {
  hostId: "local",
  generation: 4,
  requestId: 17,
  method: "item/tool/requestUserInput",
  params: {
    isBlocking: true,
    itemId: "item-a",
    questions: [],
    threadId: "thread-a",
    turnId: "turn-a",
  },
} as const;

it.effect("decodes application requests and preserves their transport occurrence", () =>
  Effect.gen(function* () {
    let received: CodexServerRequest | null = null;
    const requests = makeCodexApplicationServerRequests({
      current: () => ({
        handle: (request) => {
          received = request;
          return Promise.resolve(CodexApplicationRequestPending);
        },
      }),
    });

    const result = yield* requests.handle(
      input.hostId,
      input.generation,
      input.requestId,
      input.method,
      input.params,
      23,
    );

    assert.strictEqual(result, CodexApplicationRequestPending);
    assert.strictEqual(received?.[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN], 23);
  }),
);

it.effect("rejects admission until the application request handler exists", () =>
  Effect.gen(function* () {
    const requests = makeCodexApplicationServerRequests({ current: () => null });
    const result = yield* requests
      .handle(input.hostId, input.generation, input.requestId, input.method, input.params)
      .pipe(Effect.result);

    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.strictEqual(result.failure.code, -32_601);
  }),
);
