import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type BootstrapLogLevel = "info" | "warn" | "error";

interface BootstrapLogOptions {
  consoleEnabled?: boolean;
  fileEnabled?: boolean;
}

function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
}

export function writeBootstrapLog(
  kanbanDir: string,
  level: BootstrapLogLevel,
  message: string,
  fields: Record<string, unknown> = {},
  options: BootstrapLogOptions = {},
): void {
  const fileEnabled = options.fileEnabled ?? true;
  const consoleEnabled = options.consoleEnabled ?? true;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    pid: process.pid,
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, serializeError(value)]),
    ),
  };

  if (fileEnabled) {
    try {
      const logDir = path.join(kanbanDir, "logs");
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        path.join(logDir, `bootstrap-${entry.ts.slice(0, 10)}.log`),
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
    } catch {
      // Bootstrap logging must never block startup or shutdown.
    }
  }

  if (!consoleEnabled) return;

  const line = `[bootstrap] ${message}`;
  if (level === "error") {
    console.error(line, fields);
    return;
  }
  if (level === "warn") {
    console.warn(line, fields);
    return;
  }
  console.info(line, fields);
}
