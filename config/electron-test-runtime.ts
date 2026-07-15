type RuntimeVersions = Readonly<Record<string, string | undefined>>;

type ElectronTestSuite = "integration" | "main";

const commandBySuite: Record<ElectronTestSuite, string> = {
  integration: "pnpm test:integration <test-file>",
  main: "pnpm test:main <test-file>",
};

export function assertElectronTestRuntime(
  suite: ElectronTestSuite,
  versions: RuntimeVersions = process.versions,
): void {
  if (versions.electron) return;

  const nodeVersion = versions.node ?? "unknown";
  const moduleAbi = versions.modules ?? "unknown";

  throw new Error(
    [
      `${suite} tests must run in Electron's Node runtime.`,
      `Use \`${commandBySuite[suite]}\`.`,
      "Do not invoke this Vitest config directly: host Node cannot load Electron-built native addons.",
      `Detected host Node ${nodeVersion} with NODE_MODULE_VERSION ${moduleAbi}.`,
    ].join("\n"),
  );
}
