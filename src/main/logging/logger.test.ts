import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ORIGINAL_ENV = {
  NODEX_DIR: process.env.NODEX_DIR,
  NODEX_LOG_LEVEL: process.env.NODEX_LOG_LEVEL,
  NODEX_LOG_FILE: process.env.NODEX_LOG_FILE,
  NODEX_LOG_CONSOLE: process.env.NODEX_LOG_CONSOLE,
  NODEX_LOG_DIR: process.env.NODEX_LOG_DIR,
  NODEX_INTERNAL_APP_PACKAGED: process.env.NODEX_INTERNAL_APP_PACKAGED,
};

async function importLoggerModule() {
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return import(`./logger.ts?test=${token}`);
}

function restoreEnv(): void {
  if (ORIGINAL_ENV.NODEX_DIR === undefined) delete process.env.NODEX_DIR;
  else process.env.NODEX_DIR = ORIGINAL_ENV.NODEX_DIR;

  if (ORIGINAL_ENV.NODEX_LOG_LEVEL === undefined) delete process.env.NODEX_LOG_LEVEL;
  else process.env.NODEX_LOG_LEVEL = ORIGINAL_ENV.NODEX_LOG_LEVEL;

  if (ORIGINAL_ENV.NODEX_LOG_FILE === undefined) delete process.env.NODEX_LOG_FILE;
  else process.env.NODEX_LOG_FILE = ORIGINAL_ENV.NODEX_LOG_FILE;

  if (ORIGINAL_ENV.NODEX_LOG_CONSOLE === undefined) delete process.env.NODEX_LOG_CONSOLE;
  else process.env.NODEX_LOG_CONSOLE = ORIGINAL_ENV.NODEX_LOG_CONSOLE;

  if (ORIGINAL_ENV.NODEX_LOG_DIR === undefined) delete process.env.NODEX_LOG_DIR;
  else process.env.NODEX_LOG_DIR = ORIGINAL_ENV.NODEX_LOG_DIR;

  if (ORIGINAL_ENV.NODEX_INTERNAL_APP_PACKAGED === undefined) delete process.env.NODEX_INTERNAL_APP_PACKAGED;
  else process.env.NODEX_INTERNAL_APP_PACKAGED = ORIGINAL_ENV.NODEX_INTERNAL_APP_PACKAGED;
}

async function withTempLoggerEnv(run: (root: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-logger-test-"));
  process.env.NODEX_DIR = root;
  process.env.NODEX_LOG_LEVEL = "info";
  process.env.NODEX_LOG_FILE = "true";
  process.env.NODEX_LOG_CONSOLE = "false";
  delete process.env.NODEX_LOG_DIR;

  try {
    await run(root);
  } finally {
    restoreEnv();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("backend logger", () => {
  test("redacts sensitive fields and writes to the backend log file", async () => {
    await withTempLoggerEnv(async () => {
      const loggerModule = await importLoggerModule();
      const captured: Array<Record<string, unknown>> = [];
      const unsubscribe = loggerModule.subscribeToBackendLogs((entry: Record<string, unknown>) => {
        captured.push(entry);
      });

      try {
        const logger = loggerModule.getLogger({ component: "logger-test" });
        logger.info("Testing structured logging", {
          authorization: "Bearer secret-value",
          nested: {
            apiKey: "abc123",
          },
          ok: true,
        });

        await loggerModule.shutdownBackendLogger();

        expect(captured.length).toBe(1);
        expect(captured[0].component).toBe("logger-test");
        expect(captured[0].authorization).toBe("[REDACTED]");

        const nested = captured[0].nested as Record<string, unknown>;
        expect(nested.apiKey).toBe("[REDACTED]");

        const logDir = loggerModule.getBackendLogDirectory();
        const entries = fs.readdirSync(logDir);
        expect(entries.length).toBe(1);

        const raw = fs.readFileSync(path.join(logDir, entries[0]), "utf8");
        expect(raw.includes("\"authorization\":\"[REDACTED]\"")).toBeTrue();
        expect(raw.includes("\"apiKey\":\"[REDACTED]\"")).toBeTrue();
      } finally {
        unsubscribe();
        await loggerModule.resetBackendLoggerForTests();
      }
    });
  });

  test("truncates oversized string payloads", async () => {
    await withTempLoggerEnv(async () => {
      const loggerModule = await importLoggerModule();
      const captured: Array<Record<string, unknown>> = [];
      const unsubscribe = loggerModule.subscribeToBackendLogs((entry: Record<string, unknown>) => {
        captured.push(entry);
      });

      try {
        const logger = loggerModule.getLogger({ component: "logger-test" });
        logger.info("Testing truncation", {
          longValue: "x".repeat(3_000),
        });

        expect(captured.length).toBe(1);
        const longValue = captured[0].longValue;
        expect(typeof longValue).toBe("string");
        expect((longValue as string).length < 3_000).toBeTrue();
        expect((longValue as string).endsWith("…")).toBeTrue();
      } finally {
        unsubscribe();
        await loggerModule.resetBackendLoggerForTests();
      }
    });
  });

  test("does not write production packaged logs unless a sink is explicitly enabled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-logger-test-"));
    const logDir = path.join(root, "logs");
    process.env.NODEX_DIR = root;
    process.env.NODEX_INTERNAL_APP_PACKAGED = "true";
    process.env.NODEX_LOG_LEVEL = "info";
    process.env.NODEX_LOG_DIR = logDir;
    delete process.env.NODEX_LOG_FILE;
    delete process.env.NODEX_LOG_CONSOLE;

    try {
      const loggerModule = await importLoggerModule();
      const logger = loggerModule.getLogger({ component: "logger-test" });
      logger.info("Testing packaged default logging");
      await loggerModule.shutdownBackendLogger();

      expect(fs.existsSync(logDir)).toBeFalse();
      await loggerModule.resetBackendLoggerForTests();
    } finally {
      restoreEnv();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows packaged file logging when explicitly enabled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-logger-test-"));
    const logDir = path.join(root, "logs");
    process.env.NODEX_DIR = root;
    process.env.NODEX_INTERNAL_APP_PACKAGED = "true";
    process.env.NODEX_LOG_LEVEL = "info";
    process.env.NODEX_LOG_FILE = "true";
    process.env.NODEX_LOG_CONSOLE = "false";
    process.env.NODEX_LOG_DIR = logDir;

    try {
      const loggerModule = await importLoggerModule();
      const logger = loggerModule.getLogger({ component: "logger-test" });
      logger.info("Testing packaged opt-in logging");
      await loggerModule.shutdownBackendLogger();

      const entries = fs.readdirSync(logDir);
      expect(entries.length).toBe(1);
      await loggerModule.resetBackendLoggerForTests();
    } finally {
      restoreEnv();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
