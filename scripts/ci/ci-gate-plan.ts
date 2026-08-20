export const STATIC_GROUPS = [
  "types",
  "ui-contracts",
  "ci-contracts",
  "repository-contracts",
  "generated",
  "landing",
] as const;

export type StaticGroup = typeof STATIC_GROUPS[number];

export const APP_TEST_SUITES = [
  "unit",
  "core-client",
  "main",
  "renderer",
  "integration",
] as const;

export type AppTestSuite = typeof APP_TEST_SUITES[number];

export type DependencyKind =
  | "editor"
  | "github-actions"
  | "javascript"
  | "none"
  | "rust"
  | "source";

export interface CiGatePlan {
  readonly allGates: boolean;
  readonly appTestSuites: readonly AppTestSuite[];
  readonly browser: boolean;
  readonly dependencyKind: DependencyKind;
  readonly docsOnly: boolean;
  readonly electronE2e: boolean;
  readonly landingOnly: boolean;
  readonly protocolContracts: boolean;
  readonly releaseTransition: boolean;
  readonly runtimeMac: boolean;
  readonly rustFast: boolean;
  readonly rustMigration: boolean;
  readonly staticGroups: readonly StaticGroup[];
  readonly stress: boolean;
}

const PLAN_KEYS = [
  "allGates",
  "appTestSuites",
  "browser",
  "dependencyKind",
  "docsOnly",
  "electronE2e",
  "landingOnly",
  "protocolContracts",
  "releaseTransition",
  "runtimeMac",
  "rustFast",
  "rustMigration",
  "staticGroups",
  "stress",
] as const satisfies readonly (keyof CiGatePlan)[];

const DEPENDENCY_KINDS = new Set<DependencyKind>([
  "editor",
  "github-actions",
  "javascript",
  "none",
  "rust",
  "source",
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (value: Readonly<Record<string, unknown>>): void => {
  const expected = new Set<string>(PLAN_KEYS);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = PLAN_KEYS.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0) throw new Error(`CI gate plan has unknown fields: ${unknown.join(", ")}.`);
  if (missing.length > 0) throw new Error(`CI gate plan is missing fields: ${missing.join(", ")}.`);
};

function assertBoolean(value: unknown, name: keyof CiGatePlan): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`CI gate plan ${name} must be boolean.`);
}

function assertEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: keyof CiGatePlan,
): asserts value is readonly T[] {
  const allowedValues = new Set<string>(allowed);
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && allowedValues.has(entry))) {
    throw new Error(`CI gate plan ${name} contains an unsupported value.`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`CI gate plan ${name} must not contain duplicates.`);
  }
}

const hasOrdinaryGates = (plan: CiGatePlan): boolean =>
  plan.staticGroups.length > 0
  || plan.appTestSuites.length > 0
  || plan.protocolContracts
  || plan.rustFast
  || plan.rustMigration
  || plan.stress
  || plan.browser
  || plan.electronE2e
  || plan.runtimeMac;

export function assertCiGatePlan(value: unknown): asserts value is CiGatePlan {
  if (!isRecord(value)) throw new Error("CI gate plan must be an object.");
  assertExactKeys(value);
  for (const key of [
    "allGates",
    "browser",
    "docsOnly",
    "electronE2e",
    "landingOnly",
    "protocolContracts",
    "releaseTransition",
    "runtimeMac",
    "rustFast",
    "rustMigration",
    "stress",
  ] as const) {
    assertBoolean(value[key], key);
  }
  assertEnumArray(value.appTestSuites, APP_TEST_SUITES, "appTestSuites");
  assertEnumArray(value.staticGroups, STATIC_GROUPS, "staticGroups");
  if (typeof value.dependencyKind !== "string" || !DEPENDENCY_KINDS.has(value.dependencyKind as DependencyKind)) {
    throw new Error("CI gate plan dependencyKind is unsupported.");
  }
  const candidate = value as unknown as CiGatePlan;
  const narrowModes = [candidate.docsOnly, candidate.landingOnly, candidate.releaseTransition].filter(Boolean);
  if (narrowModes.length > 1) throw new Error("CI gate plan narrow modes are mutually exclusive.");
  if (candidate.protocolContracts && !candidate.rustFast) {
    throw new Error("Protocol contracts require the Rust fast job as their execution owner.");
  }
  if ((candidate.docsOnly || candidate.releaseTransition) && hasOrdinaryGates(candidate)) {
    throw new Error("Docs-only and release-transition plans must not select ordinary gates.");
  }
  if (candidate.landingOnly && (
    candidate.staticGroups.length !== 1
    || candidate.staticGroups[0] !== "landing"
    || candidate.appTestSuites.length > 0
    || candidate.protocolContracts
    || candidate.rustFast
    || candidate.rustMigration
    || candidate.stress
    || candidate.browser
    || candidate.electronE2e
    || candidate.runtimeMac
  )) {
    throw new Error("Landing-only plans may select only the landing static group.");
  }
}

export const parseCiGatePlan = (value: unknown): CiGatePlan => {
  assertCiGatePlan(value);
  return value;
};

export const requiredJobIdsForGatePlan = (plan: CiGatePlan): readonly string[] => {
  if (plan.releaseTransition) return ["release-transition"];
  const jobs: string[] = [];
  if (plan.staticGroups.length > 0) jobs.push("static-contracts");
  if (plan.appTestSuites.length > 0) jobs.push("app-tests");
  if (plan.rustFast) jobs.push("rust-pr");
  if (plan.rustMigration) jobs.push("rust-migration");
  if (plan.stress) jobs.push("stress-tests");
  if (plan.browser) jobs.push("browser-tests");
  if (plan.electronE2e) jobs.push("electron-e2e");
  if (plan.runtimeMac) jobs.push("runtime-contracts");
  return jobs;
};
