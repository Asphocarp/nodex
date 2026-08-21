export type LogLevelName = "trace" | "debug" | "info" | "warn" | "error" | "silent";
export type ActiveLogLevelName = Exclude<LogLevelName, "silent">;

const LOG_LEVELS: Readonly<Record<LogLevelName, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

export interface LogSinkLevels {
  console: LogLevelName;
  file: LogLevelName;
  observer: LogLevelName;
}

export function parseLogLevel(value: string | undefined, fallback: LogLevelName): LogLevelName {
  const normalized = value?.trim().toLowerCase();
  if (normalized && Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)) {
    return normalized as LogLevelName;
  }
  return fallback;
}

export function resolveLogSinkLevels(env: NodeJS.ProcessEnv): LogSinkLevels {
  const legacyLevel = env.NODEX_LOG_LEVEL ? parseLogLevel(env.NODEX_LOG_LEVEL, "info") : null;

  return {
    console: parseLogLevel(env.NODEX_LOG_CONSOLE_LEVEL, legacyLevel ?? "warn"),
    file: parseLogLevel(env.NODEX_LOG_FILE_LEVEL, legacyLevel ?? "info"),
    observer: parseLogLevel(env.NODEX_LOG_OBSERVER_LEVEL, legacyLevel ?? "warn"),
  };
}

export function isLogLevelEnabled(level: ActiveLogLevelName, threshold: LogLevelName): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[threshold];
}
