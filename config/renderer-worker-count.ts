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

export const rendererWorkerAllocation = ({
  ci,
}: {
  readonly ci: boolean;
}): {
  readonly regular: number;
  readonly workbenchShell: number;
} => {
  const total = rendererWorkerCount({ ci, stress: false });
  return {
    regular: Math.max(1, total - 1),
    workbenchShell: 1,
  };
};
