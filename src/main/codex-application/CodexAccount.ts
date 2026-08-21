import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

type AccountReadResponse = ClientRequestResponsesByMethod["account/read"];
type RateLimitsReadResponse = ClientRequestResponsesByMethod["account/rateLimits/read"];
type UsageReadResponse = ClientRequestResponsesByMethod["account/usage/read"];

export interface CodexAccountSnapshot {
  readonly account: AccountReadResponse | null;
  readonly rateLimits: RateLimitsReadResponse | null;
  readonly usage: UsageReadResponse | null;
}

export interface CodexAccountOptions {
  readonly pollInterval: Duration.Input;
  readonly refreshOnStart?: boolean;
}

export class CodexAccount extends Context.Service<
  CodexAccount,
  {
    readonly snapshot: SubscriptionRef.SubscriptionRef<CodexAccountSnapshot>;
    readonly refresh: Effect.Effect<CodexAccountSnapshot, CodexRuntimeError>;
    readonly login: (
      params: ClientRequestParamsByMethod["account/login/start"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["account/login/start"], CodexRuntimeError>;
    readonly cancelLogin: (
      params: ClientRequestParamsByMethod["account/login/cancel"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["account/login/cancel"], CodexRuntimeError>;
    readonly logout: (
      params: ClientRequestParamsByMethod["account/logout"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["account/logout"], CodexRuntimeError>;
    readonly consumeRateLimitResetCredit: (
      params: ClientRequestParamsByMethod["account/rateLimitResetCredit/consume"],
    ) => Effect.Effect<
      ClientRequestResponsesByMethod["account/rateLimitResetCredit/consume"],
      CodexRuntimeError
    >;
  }
>()("nodex/main/codex-application/CodexAccount") {}

export const live = (
  options: CodexAccountOptions,
): Layer.Layer<CodexAccount, never, CodexGateway> =>
  Layer.effect(
    CodexAccount,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const snapshot = yield* SubscriptionRef.make<CodexAccountSnapshot>({
        account: null,
        rateLimits: null,
        usage: null,
      });

      const refresh = Effect.fn("CodexAccount.refresh")(function* () {
        const [account, rateLimits, usage] = yield* Effect.all(
          [
            gateway.requestLocal("account/read", {}),
            gateway.requestLocal("account/rateLimits/read", undefined),
            gateway.requestLocal("account/usage/read", undefined),
          ] as const,
          { concurrency: "unbounded" },
        );
        const next = { account, rateLimits, usage };
        yield* SubscriptionRef.set(snapshot, next);
        return next;
      });

      const refreshWhenConnected = gateway.connection(gateway.localHostId).pipe(
        Effect.flatMap((connection) => (connection.kind === "ready" ? refresh() : Effect.void)),
        Effect.ignore,
      );
      const polling = Effect.repeat(refreshWhenConnected, Schedule.spaced(options.pollInterval));
      yield* Effect.forkScoped(polling);
      yield* gateway.events.pipe(
        Stream.filter(
          (event) => event.kind === "notification" && event.value.method.startsWith("account/"),
        ),
        Stream.runForEach(() => refresh().pipe(Effect.ignore)),
        Effect.forkScoped,
      );
      if (options.refreshOnStart === true) yield* refresh().pipe(Effect.ignore);

      return CodexAccount.of({
        snapshot,
        refresh: refresh(),
        login: (params) => gateway.requestLocal("account/login/start", params),
        cancelLogin: (params) => gateway.requestLocal("account/login/cancel", params),
        logout: (params) => gateway.requestLocal("account/logout", params),
        consumeRateLimitResetCredit: (params) =>
          gateway.requestLocal("account/rateLimitResetCredit/consume", params),
      });
    }),
  );
