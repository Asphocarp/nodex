/** A stateless native mutation kernel reports the exact aggregate transition it produced. */
export type NativeNodexAgentMutationTransition<Pending> =
  | { readonly kind: "keep" }
  | { readonly kind: "retain"; readonly pending: Pending }
  | { readonly kind: "clear"; readonly operationId: string };

export interface NativeNodexAgentMutationStep<Result, Pending> {
  readonly result: Result;
  readonly transition: NativeNodexAgentMutationTransition<Pending>;
}
