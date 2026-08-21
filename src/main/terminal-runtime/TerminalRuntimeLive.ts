import * as Layer from "effect/Layer";
import * as TerminalEnvironment from "../platform/node/TerminalEnvironment";
import * as TerminalProcessMetrics from "../platform/node/TerminalProcessMetrics";
import * as TerminalPty from "../platform/node/TerminalPty";
import * as TerminalRuntimeMap from "./TerminalRuntimeMap";
import * as TerminalSessions from "./TerminalSessions";

const runtimeMap = TerminalRuntimeMap.live.pipe(Layer.provide(TerminalPty.live));

/** Complete process-scoped Terminal graph; each session owns a nested PTY scope. */
export const live: Layer.Layer<TerminalSessions.TerminalSessions> = TerminalSessions.live.pipe(
  Layer.provide(Layer.mergeAll(TerminalEnvironment.live, TerminalProcessMetrics.live, runtimeMap)),
);
