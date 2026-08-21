import { appendFileSync } from "node:fs";
import path from "node:path";

import { APP_TEST_SUITES, type AppTestSuite } from "./ci-gate-plan";

export interface AppTestSuitePlan {
  readonly needsPlaywright: boolean;
  readonly needsRust: boolean;
  readonly needsXvfb: boolean;
  readonly packageScript: string;
  readonly relatedPackageScript: string;
}

const SUITE_PLANS: Readonly<Record<AppTestSuite, AppTestSuitePlan>> = {
  browser: {
    needsPlaywright: true,
    needsRust: false,
    needsXvfb: false,
    packageScript: "test:browser",
    relatedPackageScript: "test:browser:related",
  },
  "core-client": {
    needsPlaywright: false,
    needsRust: true,
    needsXvfb: false,
    packageScript: "test:core-client",
    relatedPackageScript: "test:core-client:related",
  },
  integration: {
    needsPlaywright: false,
    needsRust: true,
    needsXvfb: true,
    packageScript: "test:integration:ci",
    relatedPackageScript: "test:integration:ci:related",
  },
  main: {
    needsPlaywright: false,
    needsRust: true,
    needsXvfb: true,
    packageScript: "test:main",
    relatedPackageScript: "test:main:related",
  },
  renderer: {
    needsPlaywright: false,
    needsRust: false,
    needsXvfb: false,
    packageScript: "test:renderer",
    relatedPackageScript: "test:renderer:related",
  },
  unit: {
    needsPlaywright: false,
    needsRust: false,
    needsXvfb: false,
    packageScript: "test:unit",
    relatedPackageScript: "test:unit:related",
  },
};

export const planAppTestSuite = (suite: AppTestSuite): AppTestSuitePlan => SUITE_PLANS[suite];

export const parseAppTestSuite = (value: string): AppTestSuite => {
  if ((APP_TEST_SUITES as readonly string[]).includes(value)) return value as AppTestSuite;
  throw new Error(`Unknown application test suite: ${JSON.stringify(value)}.`);
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
};

const main = (): void => {
  const suite = parseAppTestSuite(readOption(process.argv.slice(2), "--suite") ?? "");
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required.");
  const suitePlan = planAppTestSuite(suite);
  appendFileSync(
    output,
    [
      `needs_playwright=${suitePlan.needsPlaywright}`,
      `needs_rust=${suitePlan.needsRust}`,
      `needs_xvfb=${suitePlan.needsXvfb}`,
      "",
    ].join("\n"),
    "utf8",
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
