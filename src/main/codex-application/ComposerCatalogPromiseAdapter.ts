import type {
  CodexComposerPlugin,
  CodexComposerPluginActivateInput,
  CodexComposerSkill,
  CodexModelOption,
} from "../../shared/types";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { ComposerCatalog } from "./ComposerCatalog";

export interface ComposerCatalogPromiseAdapter {
  readonly listModels: () => Promise<CodexModelOption[]>;
  readonly listPlugins: (cwds: readonly string[]) => Promise<CodexComposerPlugin[]>;
  readonly activatePlugin: (input: CodexComposerPluginActivateInput) => Promise<void>;
  readonly listSkills: (cwds: readonly string[]) => Promise<CodexComposerSkill[]>;
}

export const makeComposerCatalogPromiseAdapter = (
  catalog: ComposerCatalog["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): ComposerCatalogPromiseAdapter => ({
  listModels: () => callbacks.runPromise(catalog.listModels).then((items) => [...items]),
  listPlugins: (cwds) =>
    callbacks.runPromise(catalog.listPlugins(cwds)).then((items) => [...items]),
  activatePlugin: (input) => callbacks.runPromise(catalog.activatePlugin(input)),
  listSkills: (cwds) => callbacks.runPromise(catalog.listSkills(cwds)).then((items) => [...items]),
});
