const LOADING_RESULTS_HASH_MODULUS = 2_147_483_647;
const LOADING_RESULTS_LCG_MULTIPLIER = 48_271;

function clampPercent(value: number): number {
  return Math.max(1, Math.min(100, value));
}

function hashLoadingResultsSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % LOADING_RESULTS_HASH_MODULUS;
  }
  return hash === 0 ? 1 : hash;
}

export function buildLoadingResultsWidths({
  count,
  maxWidth,
  minWidth,
  seed,
}: {
  count: number;
  maxWidth: number;
  minWidth: number;
  seed: string;
}): number[] {
  const lower = clampPercent(Math.min(minWidth, maxWidth));
  const upper = clampPercent(Math.max(minWidth, maxWidth));
  const range = upper - lower;
  let state = hashLoadingResultsSeed(`${seed}:${count}:${lower}:${upper}`);

  return Array.from({ length: Math.max(0, count) }, () => {
    state = (state * LOADING_RESULTS_LCG_MULTIPLIER)
      % LOADING_RESULTS_HASH_MODULUS;
    return lower + (state / LOADING_RESULTS_HASH_MODULUS) * range;
  });
}
