import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

type ThreadListResponse = ClientRequestResponsesByMethod["thread/list"];

export class ThreadCatalog extends Context.Service<
  ThreadCatalog,
  {
    readonly snapshots: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, ThreadListResponse>>;
    readonly list: (
      hostId: string,
      params: ClientRequestParamsByMethod["thread/list"],
    ) => Effect.Effect<ThreadListResponse, CodexRuntimeError>;
    readonly search: (
      hostId: string,
      params: ClientRequestParamsByMethod["thread/search"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["thread/search"], CodexRuntimeError>;
    readonly read: (
      threadId: string,
      params: ClientRequestParamsByMethod["thread/read"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["thread/read"], CodexRuntimeError>;
    readonly invalidateHost: (hostId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/ThreadCatalog") {}

const snapshotKey = (hostId: string, params: ClientRequestParamsByMethod["thread/list"]): string =>
  `${hostId}:${JSON.stringify(params)}`;

export const live: Layer.Layer<ThreadCatalog, never, CodexGateway> = Layer.effect(
  ThreadCatalog,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const snapshots = yield* SubscriptionRef.make<ReadonlyMap<string, ThreadListResponse>>(
      new Map(),
    );
    const invalidateHost = Effect.fn("ThreadCatalog.invalidateHost")((hostId: string) =>
      SubscriptionRef.update(
        snapshots,
        (current) => new Map([...current].filter(([key]) => !key.startsWith(`${hostId}:`))),
      ),
    );
    yield* gateway.events.pipe(
      Stream.filter(
        (event) =>
          event.kind === "notification" &&
          (event.value.method.startsWith("thread/") || event.value.method.startsWith("turn/")),
      ),
      Stream.runForEach((event) =>
        event.kind === "notification" ? invalidateHost(event.hostId) : Effect.void,
      ),
      Effect.forkScoped,
    );
    return ThreadCatalog.of({
      snapshots,
      list: (hostId, params) =>
        gateway.requestOnHost(hostId, "thread/list", params).pipe(
          Effect.tap((response) =>
            SubscriptionRef.update(snapshots, (current) => {
              const next = new Map(current);
              next.set(snapshotKey(hostId, params), response);
              return next;
            }),
          ),
        ),
      search: (hostId, params) => gateway.requestOnHost(hostId, "thread/search", params),
      read: (threadId, params) => gateway.requestForThread(threadId, "thread/read", params),
      invalidateHost,
    });
  }),
);
