/* oxlint-disable effecttsgo/async-function, effecttsgo/process-env-in-effect -- Process environment materialization is a Node child-process adapter boundary. */
import * as Effect from "effect/Effect";
import { materializeCodexFeatureDefaults } from "../../codex/codex-feature-defaults";
import type { ProviderCredentialStore } from "../electron/ProviderCredentialStore";
import { codexRuntimeError } from "../../codex-runtime/CodexRuntimeError";

export const resolveCodexProcessEnvironment = (input: {
  readonly additionalSearchPaths: readonly string[];
  readonly pathDelimiter: string;
  readonly providerCredentialStore: Pick<ProviderCredentialStore, "buildRuntimeEnvOverlay">;
  readonly runtimeStateHome: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      await materializeCodexFeatureDefaults(input.runtimeStateHome);
      const inheritedPath = process.env.PATH ?? "";
      return {
        ...process.env,
        ...(await input.providerCredentialStore.buildRuntimeEnvOverlay()),
        INTERPRETER_HOME: input.runtimeStateHome,
        PATH: [...input.additionalSearchPaths, inheritedPath]
          .filter(Boolean)
          .join(input.pathDelimiter),
      };
    },
    catch: (cause) =>
      codexRuntimeError({
        operation: "session.resolve-environment",
        reason: "spawn",
        retryable: false,
        hostId: "local",
        cause,
      }),
  });
