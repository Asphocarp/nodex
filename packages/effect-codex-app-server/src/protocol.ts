import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import * as CodexError from "./errors.ts";
import { JsonRpcId, JsonRpcResponseEnvelope } from "./_internal/shared.ts";
const isJsonRpcId = Schema.is(JsonRpcId);
const isJsonRpcResponseEnvelope = Schema.is(JsonRpcResponseEnvelope);
const isCodexAppServerError = Schema.is(CodexError.CodexAppServerError);

export interface CodexAppServerProtocolLogEvent {
  readonly direction: "incoming" | "outgoing";
  readonly stage: "raw" | "decoded" | "decode_failed";
  readonly payload: unknown;
}

export interface CodexAppServerIncomingNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface CodexAppServerIncomingRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

/** The app-server withdrew this request, so the client must not write a stale response. */
export const CodexAppServerNoResponse = Symbol.for(
  "@nodex/effect-codex-app-server/CodexAppServerNoResponse",
);

export interface CodexAppServerPatchedProtocolOptions {
  readonly stdio: Stdio.Stdio;
  readonly terminationError?: Effect.Effect<CodexError.CodexAppServerError>;
  /** Maximum decoded messages retained when the protocol is used as a raw Stream source. */
  readonly incomingCapacity?: number;
  /** Maximum encoded messages waiting for the physical writer. */
  readonly outgoingCapacity?: number;
  /** Maximum bytes retained across decoded incoming queues. */
  readonly incomingByteCapacity?: number;
  /** Maximum bytes retained by the physical writer queue. */
  readonly outgoingByteCapacity?: number;
  /** Maximum bytes accepted for one JSONL message in either direction. */
  readonly maximumFrameBytes?: number;
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (event: CodexAppServerProtocolLogEvent) => Effect.Effect<void>;
  readonly onNotification?: (
    notification: CodexAppServerIncomingNotification,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly onRequest?: (
    request: CodexAppServerIncomingRequest,
  ) => Effect.Effect<unknown | typeof CodexAppServerNoResponse, CodexError.CodexAppServerError>;
  readonly onTermination?: (error: CodexError.CodexAppServerError) => Effect.Effect<void>;
}

export interface CodexAppServerPatchedProtocol {
  readonly incomingNotifications: Stream.Stream<
    CodexAppServerIncomingNotification,
    CodexError.CodexAppServerError
  >;
  readonly incomingRequests: Stream.Stream<
    CodexAppServerIncomingRequest,
    CodexError.CodexAppServerError
  >;
  /** Fails exactly once when any physical protocol component stops making progress. */
  readonly termination: Effect.Effect<never, CodexError.CodexAppServerError>;
  readonly request: (
    method: string,
    payload?: unknown,
  ) => Effect.Effect<unknown, CodexError.CodexAppServerError>;
  readonly notify: (
    method: string,
    payload?: unknown,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly respond: (
    requestId: string | number,
    result: unknown,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly respondError: (
    requestId: string | number,
    error: CodexError.CodexAppServerRequestError,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
}

interface CodexAppServerPendingRequest {
  readonly deferred: Deferred.Deferred<unknown, CodexError.CodexAppServerError>;
  readonly method: string;
}

interface BufferedMessage<A> {
  readonly bytes: number;
  readonly value: A;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIncomingRequest(value: unknown): value is CodexAppServerIncomingRequest {
  if (!isObject(value) || typeof value.method !== "string") {
    return false;
  }
  return isJsonRpcId(value.id);
}

function isIncomingNotification(value: unknown): value is CodexAppServerIncomingNotification {
  return isObject(value) && typeof value.method === "string" && !("id" in value);
}

function isIncomingResponse(value: unknown): value is typeof JsonRpcResponseEnvelope.Type {
  return isJsonRpcResponseEnvelope(value);
}

const encodeJsonString = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJsonString = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const wireEncoder = new TextEncoder();

const encodeWireMessage = (
  message: Record<string, unknown>,
): Effect.Effect<string, CodexError.CodexAppServerProtocolParseError> =>
  encodeJsonString(message).pipe(
    Effect.map((encoded) => `${encoded}\n`),
    Effect.mapError((cause) => {
      const method = typeof message.method === "string" ? message.method : undefined;
      const requestId =
        typeof message.id === "string" || typeof message.id === "number"
          ? String(message.id)
          : undefined;
      return CodexError.CodexAppServerProtocolParseError.fromSchemaError(
        "encode-wire-message",
        cause,
        {
          ...(method === undefined ? {} : { method }),
          ...(requestId === undefined ? {} : { requestId }),
        },
      );
    }),
  );

const decodeWireMessage = (
  line: string,
): Effect.Effect<unknown, CodexError.CodexAppServerProtocolParseError> =>
  decodeJsonString(line).pipe(
    Effect.mapError((cause) =>
      CodexError.CodexAppServerProtocolParseError.fromSchemaError("decode-wire-message", cause),
    ),
  );

const normalizeIncomingError = (
  error: unknown,
  operation: CodexError.CodexAppServerTransportOperation,
): CodexError.CodexAppServerError =>
  isCodexAppServerError(error)
    ? error
    : new CodexError.CodexAppServerTransportError({
        operation,
        cause: error,
      });

const toProtocolMessage = (
  requestId: string | number,
  fields: {
    readonly result?: unknown;
    readonly error?: CodexError.CodexAppServerProtocolErrorShape;
  },
): { readonly [key: string]: unknown } => ({
  id: requestId,
  ...(fields.result !== undefined ? { result: fields.result } : {}),
  ...(fields.error !== undefined ? { error: fields.error } : {}),
});

export const makeCodexAppServerPatchedProtocol = Effect.fn("makeCodexAppServerPatchedProtocol")(
  function* (
    options: CodexAppServerPatchedProtocolOptions,
  ): Effect.fn.Return<CodexAppServerPatchedProtocol, never, Scope.Scope> {
    const incomingCapacity = Math.max(1, Math.floor(options.incomingCapacity ?? 4_096));
    const outgoingCapacity = Math.max(1, Math.floor(options.outgoingCapacity ?? 1_024));
    const incomingByteCapacity = Math.max(
      1,
      Math.floor(options.incomingByteCapacity ?? 64 * 1_024 * 1_024),
    );
    const outgoingByteCapacity = Math.max(
      1,
      Math.floor(options.outgoingByteCapacity ?? 16 * 1_024 * 1_024),
    );
    const maximumFrameBytes = Math.max(
      1,
      Math.floor(options.maximumFrameBytes ?? 16 * 1_024 * 1_024),
    );
    const outgoing = yield* Queue.dropping<BufferedMessage<string>, CodexError.CodexAppServerError>(
      outgoingCapacity,
    );
    const incomingNotifications = yield* Queue.dropping<
      BufferedMessage<CodexAppServerIncomingNotification>,
      CodexError.CodexAppServerError
    >(incomingCapacity);
    const incomingRequests = yield* Queue.dropping<
      BufferedMessage<CodexAppServerIncomingRequest>,
      CodexError.CodexAppServerError
    >(incomingCapacity);
    const incomingBufferedBytes = yield* Ref.make(0);
    const outgoingBufferedBytes = yield* Ref.make(0);
    const outgoingAdmission = yield* Semaphore.make(1);
    const pending = yield* Ref.make(new Map<string, CodexAppServerPendingRequest>());
    const nextRequestId = yield* Ref.make(1);
    const remainder = yield* Ref.make("");
    const terminationState = yield* Ref.make<CodexError.CodexAppServerError | null>(null);
    const termination = yield* Deferred.make<never, CodexError.CodexAppServerError>();

    const logProtocol = (event: CodexAppServerProtocolLogEvent) => {
      if (event.direction === "incoming" && !options.logIncoming) {
        return Effect.void;
      }
      if (event.direction === "outgoing" && !options.logOutgoing) {
        return Effect.void;
      }
      return (
        options.logger?.(event) ??
        Effect.logDebug("Codex App Server protocol event").pipe(Effect.annotateLogs({ event }))
      );
    };

    const failAllPending = (error: CodexError.CodexAppServerError) =>
      Ref.get(pending).pipe(
        Effect.flatMap((current) =>
          Effect.forEach([...current.values()], ({ deferred }) => Deferred.fail(deferred, error), {
            discard: true,
          }),
        ),
        Effect.andThen(Ref.set(pending, new Map())),
      );

    const handleTermination = (classify: () => Effect.Effect<CodexError.CodexAppServerError>) =>
      Effect.gen(function* () {
        const error = yield* classify();
        const claimed = yield* Ref.modify(terminationState, (current) =>
          current === null ? ([true, error] as const) : ([false, current] as const),
        );
        if (!claimed) return;

        yield* Effect.all(
          [
            failAllPending(error),
            Queue.fail(outgoing, error),
            Queue.fail(incomingNotifications, error),
            Queue.fail(incomingRequests, error),
            Deferred.fail(termination, error),
          ],
          { discard: true },
        );
        if (options.onTermination) {
          yield* options
            .onTermination(error)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Codex App Server termination observer failed").pipe(
                  Effect.annotateLogs({ cause }),
                ),
              ),
            );
        }
      }).pipe(Effect.uninterruptible);

    const capacityError = (
      operation: "incoming-capacity" | "outgoing-capacity",
      capacity: number,
      unit = "messages",
    ) =>
      new CodexError.CodexAppServerTransportError({
        operation,
        cause: new Error(`Codex App Server protocol capacity ${capacity} ${unit} is exhausted`),
      });

    const reserveBytes = (
      bytes: Ref.Ref<number>,
      amount: number,
      maximum: number,
      operation: "incoming-capacity" | "outgoing-capacity",
    ) =>
      Effect.gen(function* () {
        const reserved = yield* Ref.modify(bytes, (current) =>
          current + amount > maximum
            ? ([false, current] as const)
            : ([true, current + amount] as const),
        );
        if (reserved) return;
        return yield* capacityError(operation, maximum, "bytes");
      });

    const releaseBytes = (bytes: Ref.Ref<number>, amount: number) =>
      Ref.update(bytes, (current) => Math.max(0, current - amount));

    const terminateOutgoingCapacity = (error: CodexError.CodexAppServerTransportError) =>
      handleTermination(() => Effect.succeed(error)).pipe(Effect.andThen(Effect.fail(error)));

    const offerOutgoing = (
      message: Record<string, unknown>,
    ): Effect.Effect<void, CodexError.CodexAppServerError> =>
      outgoingAdmission
        .withPermits(1)(
          Effect.gen(function* () {
            const stopped = yield* Ref.get(terminationState);
            if (stopped !== null) return yield* stopped;
            yield* logProtocol({
              direction: "outgoing",
              stage: "decoded",
              payload: message,
            });
            const encoded = yield* encodeWireMessage(message);
            const bytes = wireEncoder.encode(encoded).byteLength;
            if (bytes > maximumFrameBytes) {
              return yield* capacityError("outgoing-capacity", maximumFrameBytes, "frame bytes");
            }
            yield* logProtocol({
              direction: "outgoing",
              stage: "raw",
              payload: encoded,
            });
            yield* reserveBytes(
              outgoingBufferedBytes,
              bytes,
              outgoingByteCapacity,
              "outgoing-capacity",
            );
            const accepted = yield* Queue.offer(outgoing, { bytes, value: encoded });
            if (accepted) return;
            yield* releaseBytes(outgoingBufferedBytes, bytes);
            const terminated = yield* Ref.get(terminationState);
            if (terminated !== null) return yield* terminated;
            return yield* capacityError("outgoing-capacity", outgoingCapacity);
          }),
        )
        .pipe(
          Effect.catchTag("CodexAppServerTransportError", (error) =>
            error.operation === "outgoing-capacity"
              ? terminateOutgoingCapacity(error)
              : Effect.fail(error),
          ),
        );

    const removePending = (requestId: string) =>
      Ref.update(pending, (current) => {
        if (!current.has(requestId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(requestId);
        return next;
      });

    const resolvePending = (
      requestId: string,
      handler: (pendingRequest: CodexAppServerPendingRequest) => Effect.Effect<void>,
    ) =>
      Ref.modify(pending, (current) => {
        const pendingRequest = current.get(requestId);
        if (!pendingRequest) {
          return [Effect.void, current] as const;
        }
        const next = new Map(current);
        next.delete(requestId);
        return [handler(pendingRequest), next] as const;
      }).pipe(Effect.flatten);

    const respond = (requestId: string | number, result: unknown) =>
      offerOutgoing(toProtocolMessage(requestId, { result }));

    const respondError = (
      requestId: string | number,
      error: CodexError.CodexAppServerRequestError,
    ) => offerOutgoing(toProtocolMessage(requestId, { error: error.toProtocolError() }));

    const handleResponse = (response: typeof JsonRpcResponseEnvelope.Type) => {
      const requestId = String(response.id);
      const protocolError = response.error;
      if (protocolError !== undefined) {
        return resolvePending(requestId, ({ deferred, method }) =>
          Deferred.fail(
            deferred,
            CodexError.CodexAppServerRequestError.fromProtocolError(
              protocolError,
              method,
              requestId,
            ),
          ),
        );
      }
      return resolvePending(requestId, ({ deferred }) =>
        Deferred.succeed(deferred, response.result),
      );
    };

    const offerIncoming = <A>(
      queue: Queue.Queue<BufferedMessage<A>, CodexError.CodexAppServerError>,
      value: A,
      bytes: number,
    ) =>
      Effect.gen(function* () {
        yield* reserveBytes(
          incomingBufferedBytes,
          bytes,
          incomingByteCapacity,
          "incoming-capacity",
        );
        const accepted = yield* Queue.offer(queue, { bytes, value });
        if (accepted) return;
        yield* releaseBytes(incomingBufferedBytes, bytes);
        return yield* capacityError("incoming-capacity", incomingCapacity);
      });

    const handleRequest = (request: CodexAppServerIncomingRequest, bytes: number) =>
      Effect.gen(function* () {
        if (!options.onRequest) {
          yield* offerIncoming(incomingRequests, request, bytes);
          return;
        }
        const result = yield* options.onRequest(request);
        if (result !== CodexAppServerNoResponse) yield* respond(request.id, result);
      });

    const handleNotification = (notification: CodexAppServerIncomingNotification, bytes: number) =>
      Effect.gen(function* () {
        if (!options.onNotification) {
          yield* offerIncoming(incomingNotifications, notification, bytes);
          return;
        }
        yield* options.onNotification(notification);
      });

    const routeMessage = (
      message: unknown,
      bytes: number,
    ): Effect.Effect<void, CodexError.CodexAppServerError> => {
      if (isIncomingRequest(message)) {
        return handleRequest(message, bytes);
      }
      if (isIncomingNotification(message)) {
        return handleNotification(message, bytes);
      }
      if (isIncomingResponse(message)) {
        return handleResponse(message);
      }
      return Effect.fail(
        CodexError.CodexAppServerProtocolParseError.fromUnroutableMessage(message),
      );
    };

    const handleLine = (line: string): Effect.Effect<void, CodexError.CodexAppServerError> => {
      if (line.trim().length === 0) {
        return Effect.void;
      }
      const bytes = wireEncoder.encode(line).byteLength;
      if (bytes > maximumFrameBytes) {
        return Effect.fail(capacityError("incoming-capacity", maximumFrameBytes, "frame bytes"));
      }
      return logProtocol({
        direction: "incoming",
        stage: "raw",
        payload: line,
      }).pipe(
        Effect.flatMap(() => decodeWireMessage(line)),
        Effect.tap((decoded) =>
          logProtocol({
            direction: "incoming",
            stage: "decoded",
            payload: decoded,
          }),
        ),
        Effect.tapErrorTag("CodexAppServerProtocolParseError", (error) =>
          logProtocol({
            direction: "incoming",
            stage: "decode_failed",
            payload: {
              operation: error.operation,
              ...(error.method === undefined ? {} : { method: error.method }),
              ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
              ...(error.issueCount === undefined ? {} : { issueCount: error.issueCount }),
              ...(error.issueKinds === undefined ? {} : { issueKinds: error.issueKinds }),
              ...(error.maximumPathDepth === undefined
                ? {}
                : { maximumPathDepth: error.maximumPathDepth }),
            },
          }),
        ),
        Effect.flatMap((message) => routeMessage(message, bytes)),
      );
    };

    yield* options.stdio.stdin.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Ref.modify(remainder, (current) => {
          const combined = current + chunk;
          const lines = combined.split("\n");
          const nextRemainder = lines.pop() ?? "";
          return [
            {
              lines: lines.map((line) => line.replace(/\r$/, "")),
              remainderBytes: wireEncoder.encode(nextRemainder).byteLength,
            },
            nextRemainder,
          ] as const;
        }).pipe(
          Effect.flatMap(({ lines, remainderBytes }) =>
            remainderBytes > maximumFrameBytes
              ? Effect.fail(capacityError("incoming-capacity", maximumFrameBytes, "frame bytes"))
              : Effect.forEach(lines, handleLine, { discard: true }),
          ),
        ),
      ),
      Effect.matchEffect({
        onFailure: (error) =>
          handleTermination(() =>
            Effect.succeed(normalizeIncomingError(error, "read-input-stream")),
          ),
        onSuccess: () =>
          Ref.get(remainder).pipe(
            Effect.flatMap((line) => (line.trim().length === 0 ? Effect.void : handleLine(line))),
            Effect.matchEffect({
              onFailure: (error) => handleTermination(() => Effect.succeed(error)),
              onSuccess: () =>
                handleTermination(
                  () =>
                    options.terminationError ??
                    Effect.succeed(new CodexError.CodexAppServerInputStreamEndedError({})),
                ),
            }),
          ),
      }),
      Effect.forkScoped,
    );

    yield* Stream.fromQueue(outgoing).pipe(
      Stream.mapEffect((message) =>
        releaseBytes(outgoingBufferedBytes, message.bytes).pipe(Effect.as(message.value)),
      ),
      Stream.run(options.stdio.stdout()),
      Effect.matchEffect({
        onFailure: (error) =>
          handleTermination(() =>
            Effect.succeed(normalizeIncomingError(error, "write-output-stream")),
          ),
        onSuccess: () =>
          handleTermination(() =>
            Effect.succeed(
              new CodexError.CodexAppServerTransportError({
                operation: "write-output-stream",
                cause: new Error("Codex App Server output stream ended"),
              }),
            ),
          ),
      }),
      Effect.forkScoped,
    );

    yield* Effect.addFinalizer(() =>
      handleTermination(() =>
        Effect.succeed(
          new CodexError.CodexAppServerTransportError({
            operation: "protocol-scope-closed",
            cause: new Error("Codex App Server protocol Scope closed"),
          }),
        ),
      ),
    );

    const request = (method: string, payload?: unknown) =>
      Effect.gen(function* () {
        const requestId = yield* Ref.modify(
          nextRequestId,
          (current) => [current, current + 1] as const,
        );
        const deferred = yield* Deferred.make<unknown, CodexError.CodexAppServerError>();
        yield* Ref.update(pending, (current) =>
          new Map(current).set(String(requestId), { deferred, method }),
        );
        yield* offerOutgoing({
          id: requestId,
          method,
          ...(payload !== undefined ? { params: payload } : {}),
        }).pipe(Effect.tapError(() => removePending(String(requestId))));
        return yield* Deferred.await(deferred).pipe(
          Effect.onInterrupt(() => removePending(String(requestId))),
        );
      });

    const notify = (method: string, payload?: unknown) =>
      offerOutgoing({
        method,
        ...(payload !== undefined ? { params: payload } : {}),
      });

    return {
      incomingNotifications: Stream.fromQueue(incomingNotifications).pipe(
        Stream.mapEffect((message) =>
          releaseBytes(incomingBufferedBytes, message.bytes).pipe(Effect.as(message.value)),
        ),
      ),
      incomingRequests: Stream.fromQueue(incomingRequests).pipe(
        Stream.mapEffect((message) =>
          releaseBytes(incomingBufferedBytes, message.bytes).pipe(Effect.as(message.value)),
        ),
      ),
      termination: Deferred.await(termination),
      request,
      notify,
      respond,
      respondError,
    } satisfies CodexAppServerPatchedProtocol;
  },
);
