import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type {
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
} from "../../shared/types";
import type {
  DesktopAutomationDefinitionDeleteResult,
  DesktopAutomationModulePort,
} from "../core-client/desktop-automation-module-bridge";

export class CodexAutomationDefinitions extends Context.Service<
  CodexAutomationDefinitions,
  {
    readonly list: Effect.Effect<
      readonly CodexScheduledAutomation[],
      CodexAutomationDefinitionsError
    >;
    readonly get: (
      id: string,
    ) => Effect.Effect<CodexScheduledAutomation | null, CodexAutomationDefinitionsError>;
    readonly create: (
      input: CodexScheduledAutomationCreateInput,
    ) => Effect.Effect<CodexScheduledAutomation, CodexAutomationDefinitionsError>;
    readonly update: (
      input: CodexScheduledAutomationUpdateInput,
    ) => Effect.Effect<CodexScheduledAutomation | null, CodexAutomationDefinitionsError>;
    readonly remove: (
      id: string,
    ) => Effect.Effect<DesktopAutomationDefinitionDeleteResult, CodexAutomationDefinitionsError>;
  }
>()("nodex/main/codex-application/CodexAutomationDefinitions") {}

export class CodexAutomationDefinitionsError extends Data.TaggedError(
  "CodexAutomationDefinitionsError",
)<{
  readonly operation: "list" | "get" | "create" | "update" | "remove";
  readonly cause: unknown;
}> {}

const error = (operation: CodexAutomationDefinitionsError["operation"]) => (cause: unknown) =>
  new CodexAutomationDefinitionsError({ operation, cause });

/** Actual Promise boundary for the Core-backed automation module. */
export const fromDesktopModule = (
  module: DesktopAutomationModulePort,
): CodexAutomationDefinitions["Service"] =>
  CodexAutomationDefinitions.of({
    list: Effect.tryPromise({ try: () => module.listDefinitions(), catch: error("list") }),
    get: (id) => Effect.tryPromise({ try: () => module.getDefinition(id), catch: error("get") }),
    create: (input) =>
      Effect.tryPromise({ try: () => module.createDefinition(input), catch: error("create") }),
    update: (input) =>
      Effect.tryPromise({ try: () => module.updateDefinition(input), catch: error("update") }),
    remove: (id) =>
      Effect.tryPromise({ try: () => module.deleteDefinition(id), catch: error("remove") }),
  });
