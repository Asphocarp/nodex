import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { AgentProviderCredentialStatus } from "../../../shared/agent-runtime";
import type { ProviderCredentialStore } from "./ProviderCredentialStore";

export class ProviderCredentialsError extends Schema.TaggedError<ProviderCredentialsError>()(
  "ProviderCredentialsError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class ProviderCredentials extends Context.Service<
  ProviderCredentials,
  {
    readonly status: (
      providerId: string,
    ) => Effect.Effect<AgentProviderCredentialStatus, ProviderCredentialsError>;
    readonly set: (
      providerId: string,
      apiKey: string,
    ) => Effect.Effect<void, ProviderCredentialsError>;
    readonly remove: (providerId: string) => Effect.Effect<void, ProviderCredentialsError>;
  }
>()("nodex/main/platform/electron/ProviderCredentials") {}

const wrap = <A>(operation: string, evaluate: () => A) =>
  Effect.try({
    try: evaluate,
    catch: (cause) => new ProviderCredentialsError({ operation, cause }),
  });

export const fromStore = (store: ProviderCredentialStore): Layer.Layer<ProviderCredentials> =>
  Layer.succeed(
    ProviderCredentials,
    ProviderCredentials.of({
      status: (providerId) => wrap("status", () => store.status(providerId)),
      set: (providerId, apiKey) =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            wrap("set", () =>
              store.setApiKey(providerId, apiKey, DateTime.formatIso(DateTime.makeUnsafe(now))),
            ),
          ),
        ),
      remove: (providerId) => wrap("remove", () => store.delete(providerId)),
    }),
  );
