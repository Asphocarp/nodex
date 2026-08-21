export type VitestTestTier = "default" | "stress";

interface TieredTestFilesInput {
  readonly defaultExclude?: readonly string[];
  readonly defaultInclude: readonly string[];
  readonly stressExclude?: readonly string[];
  readonly stressInclude: readonly string[];
}

export interface TieredTestFiles {
  readonly exclude: string[];
  readonly include: string[];
  readonly isStress: boolean;
}

export function resolveVitestTestTier(value = process.env.NODEX_TEST_TIER): VitestTestTier {
  if (value === undefined || value === "default") return "default";
  if (value === "stress") return "stress";
  throw new Error(
    `NODEX_TEST_TIER must be "default" or "stress", received ${JSON.stringify(value)}`,
  );
}

export function selectTieredTestFiles(
  input: TieredTestFilesInput,
  tier = resolveVitestTestTier(),
): TieredTestFiles {
  const defaultExclude = input.defaultExclude ?? [];
  if (tier === "stress") {
    return {
      exclude: [...(input.stressExclude ?? defaultExclude)],
      include: [...input.stressInclude],
      isStress: true,
    };
  }
  return {
    exclude: [...defaultExclude, ...input.stressInclude],
    include: [...input.defaultInclude],
    isStress: false,
  };
}
