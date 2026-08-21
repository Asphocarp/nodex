import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  readTerminalProcessMetricsByRootPid,
  type TerminalProcessMetricsSnapshot,
} from "../../terminal-process-metrics";

export class TerminalProcessMetricsError extends Schema.TaggedError<TerminalProcessMetricsError>()(
  "TerminalProcessMetricsError",
  { cause: Schema.Defect() },
) {}

export class TerminalProcessMetricsReader extends Context.Service<
  TerminalProcessMetricsReader,
  {
    readonly read: (
      rootPids: readonly number[],
    ) => Effect.Effect<
      ReadonlyMap<number, TerminalProcessMetricsSnapshot>,
      TerminalProcessMetricsError
    >;
  }
>()("nodex/main/platform/node/TerminalProcessMetricsReader") {}

export const live: Layer.Layer<TerminalProcessMetricsReader> = Layer.succeed(
  TerminalProcessMetricsReader,
  TerminalProcessMetricsReader.of({
    read: (rootPids) =>
      Effect.tryPromise({
        try: () => readTerminalProcessMetricsByRootPid(rootPids),
        catch: (cause) => new TerminalProcessMetricsError({ cause }),
      }),
  }),
);
