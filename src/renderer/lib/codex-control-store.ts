import type { CodexEvent, CodexPermissionMode, CodexThreadStartProgressPhase } from "./types";

export interface CodexControlState {
  permissionModeByProject: Record<string, CodexPermissionMode>;
  threadStartProgressByTarget: Record<string, CodexThreadStartProgressState>;
}

export interface CodexThreadStartProgressState {
  projectId: string;
  cardId: string;
  phase: CodexThreadStartProgressPhase;
  message: string;
  outputText: string;
  outputCarriageReturnPending: boolean;
  updatedAt: number;
}

export type CodexControlAction =
  | { type: "event"; event: CodexEvent }
  | { type: "setPermissionMode"; projectId: string; mode: CodexPermissionMode };

export function createInitialCodexControlState(): CodexControlState {
  return {
    permissionModeByProject: {},
    threadStartProgressByTarget: {},
  };
}

function getThreadStartProgressTargetKey(projectId: string, cardId: string): string {
  return `${projectId}:${cardId}`;
}

function applyTerminalOutputDelta(input: {
  existingText: string;
  outputDelta: string;
  outputCarriageReturnPending: boolean;
}): { outputText: string; outputCarriageReturnPending: boolean } {
  let outputText = input.existingText;
  let outputCarriageReturnPending = input.outputCarriageReturnPending;

  for (const character of input.outputDelta) {
    if (outputCarriageReturnPending) {
      if (character === "\n") {
        outputText += "\n";
        outputCarriageReturnPending = false;
        continue;
      }

      const lastLineBreakIndex = outputText.lastIndexOf("\n");
      outputText = lastLineBreakIndex >= 0 ? outputText.slice(0, lastLineBreakIndex + 1) : "";
      outputCarriageReturnPending = false;
    }

    if (character === "\r") {
      outputCarriageReturnPending = true;
      continue;
    }

    if (character === "\b") {
      if (outputText.length > 0) {
        outputText = outputText.slice(0, -1);
      }
      continue;
    }

    outputText += character;
  }

  return {
    outputText,
    outputCarriageReturnPending,
  };
}

function reduceEvent(state: CodexControlState, event: CodexEvent): CodexControlState {
  if (event.type === "threadStartProgress") {
    const targetKey = getThreadStartProgressTargetKey(event.projectId, event.cardId);
    const previous = state.threadStartProgressByTarget[targetKey];
    const previousText = event.clearOutput ? "" : previous?.outputText ?? "";
    const previousCarriageReturnPending = event.clearOutput ? false : previous?.outputCarriageReturnPending ?? false;
    const mergedOutput = event.outputDelta
      ? applyTerminalOutputDelta({
          existingText: previousText,
          outputDelta: event.outputDelta,
          outputCarriageReturnPending: previousCarriageReturnPending,
        })
      : {
          outputText: previousText,
          outputCarriageReturnPending: previousCarriageReturnPending,
        };

    return {
      ...state,
      threadStartProgressByTarget: {
        ...state.threadStartProgressByTarget,
        [targetKey]: {
          projectId: event.projectId,
          cardId: event.cardId,
          phase: event.phase,
          message: event.message,
          outputText: mergedOutput.outputText,
          outputCarriageReturnPending: mergedOutput.outputCarriageReturnPending,
          updatedAt: event.updatedAt,
        },
      },
    };
  }

  return state;
}

export function codexControlStoreReducer(state: CodexControlState, action: CodexControlAction): CodexControlState {
  if (action.type === "event") {
    return reduceEvent(state, action.event);
  }

  if (action.type === "setPermissionMode") {
    return {
      ...state,
      permissionModeByProject: {
        ...state.permissionModeByProject,
        [action.projectId]: action.mode,
      },
    };
  }

  return state;
}
