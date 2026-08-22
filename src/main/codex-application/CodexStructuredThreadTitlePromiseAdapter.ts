import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexStructuredThreadTitle,
  CodexStructuredThreadTitleInput,
} from "./CodexStructuredThreadTitle";

export interface CodexStructuredThreadTitlePromiseAdapter {
  readonly generate: (input: CodexStructuredThreadTitleInput) => Promise<string | null>;
}

/** Stateless projection for CodexService's remaining title persistence policy. */
export const makeCodexStructuredThreadTitlePromiseAdapter = (
  runtime: CodexStructuredThreadTitle["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexStructuredThreadTitlePromiseAdapter => ({
  generate: (input) => callbacks.runPromise(runtime.generate(input)),
});
