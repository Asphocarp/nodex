/** A stateless native mutation kernel reports the exact aggregate transition it produced. */
export interface NodexAgentMutationEnvelope<Result> {
  readonly result: Result;
  readonly events: readonly unknown[];
  readonly metrics: {
    readonly mutationId: string;
    readonly queueWaitMs: number;
    readonly workerDurationMs: number;
    readonly transactionMs: number;
    readonly eventCount: number;
  };
}

export type NativeNodexAgentMutationTransition<Pending> =
  | { readonly kind: "keep" }
  | { readonly kind: "retain"; readonly pending: Pending }
  | { readonly kind: "clear"; readonly operationId: string };

export interface NativeNodexAgentMutationStep<Result, Pending> {
  readonly result: Result;
  readonly transition: NativeNodexAgentMutationTransition<Pending>;
}
