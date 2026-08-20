import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

interface LintDiagnostic {
  readonly code: string;
  readonly filename: string;
  readonly severity: "error" | "warning";
}

interface LintReport {
  readonly diagnostics: readonly LintDiagnostic[];
}

interface ExpectedDiagnostic {
  readonly code: string;
  readonly filename: string;
}

const projectRoot = resolve(import.meta.dirname, "../..");
const vpExecutable = resolve(
  projectRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "vp.cmd" : "vp",
);

function runLint(
  paths: readonly string[],
  extraEnvironment: Readonly<Record<string, string>> = {},
): { readonly report: LintReport; readonly status: number } {
  const result = spawnSync(
    vpExecutable,
    ["lint", "--quiet", "--format", "json", ...paths],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NODEX_TOOLING_FIXTURE_MODE: "1",
        ...extraEnvironment,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Vite+ fixture lint terminated by ${result.signal}`);
  }

  const marker = '{ "diagnostics"';
  const reportOffset = result.stdout.indexOf(marker);
  if (reportOffset < 0) {
    throw new Error([
      "Vite+ fixture lint did not return JSON.",
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }

  return {
    report: JSON.parse(result.stdout.slice(reportOffset)) as LintReport,
    status: result.status ?? 1,
  };
}

function verifyInvalidFixtures(
  expected: readonly ExpectedDiagnostic[],
  environment?: Readonly<Record<string, string>>,
): void {
  const result = runLint(expected.map(({ filename }) => filename), environment);
  if (result.status === 0) {
    throw new Error("Invalid tooling fixtures unexpectedly passed Oxlint.");
  }

  const actual = result.report.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  for (const expectation of expected) {
    const matched = actual.some((diagnostic) => (
      diagnostic.code === expectation.code
      && diagnostic.filename === expectation.filename
    ));
    if (!matched) {
      throw new Error(
        `Missing ${expectation.code} for ${expectation.filename}: ${JSON.stringify(actual)}`,
      );
    }
  }

  if (actual.length !== expected.length) {
    throw new Error(`Unexpected tooling fixture diagnostics: ${JSON.stringify(actual)}`);
  }
}

function verifyValidFixtures(
  paths: readonly string[],
  environment?: Readonly<Record<string, string>>,
): void {
  const result = runLint(paths, environment);
  if (result.status === 0 && result.report.diagnostics.length === 0) return;
  throw new Error(`Valid tooling fixtures failed Oxlint: ${JSON.stringify(result.report)}`);
}

verifyInvalidFixtures([
  {
    code: "react-hooks(rules-of-hooks)",
    filename: "scripts/fixtures/tooling/renderer/hooks-invalid.tsx",
  },
  {
    code: "eslint(no-restricted-imports)",
    filename: "scripts/fixtures/tooling/renderer/restricted-import-invalid.tsx",
  },
  {
    code: "@tanstack/query(exhaustive-deps)",
    filename: "scripts/fixtures/tooling/query-invalid.tsx",
  },
  {
    code: "eslint(no-restricted-imports)",
    filename: "scripts/fixtures/tooling/renderer-tests/barrel-import-invalid.test.ts",
  },
  {
    code: "react(only-export-components)",
    filename: "scripts/fixtures/tooling/workbench/refresh-invalid.tsx",
  },
]);

verifyValidFixtures([
  "scripts/fixtures/tooling/renderer/hooks-valid.tsx",
  "scripts/fixtures/tooling/query-valid.tsx",
  "src/renderer/components/ui/context-menu.tsx",
  "src/renderer/components/shared/icons/generic-icons.tsx",
]);

const tailwindEnvironment = { ESLINT_BETTER_TAILWIND: "1" };
verifyInvalidFixtures([
  {
    code: "better-tailwindcss(no-unknown-classes)",
    filename: "scripts/fixtures/tooling/tailwind-invalid.tsx",
  },
], tailwindEnvironment);
verifyValidFixtures([
  "scripts/fixtures/tooling/tailwind-valid.tsx",
], tailwindEnvironment);

console.log("Oxlint tooling contracts verified: hooks, query, refresh, imports, and Tailwind.");
