export const rendererWorkerCount = ({
  ci,
  stress,
}: {
  readonly ci: boolean;
  readonly stress: boolean;
}): number => {
  if (stress) return 1;
  return ci ? 4 : 2;
};
