import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type IgnoredRustTestTier =
  | "legacy-exhaustive"
  | "manual"
  | "performance"
  | "reliability"
  | "scale";

export interface IgnoredRustTest {
  readonly name: string;
  readonly reason: string;
  readonly sourcePath: string;
}

export interface IgnoredRustTestManifestEntry {
  readonly tier: IgnoredRustTestTier;
  readonly script: string;
}

interface IgnoredRustTestManifest {
  readonly tests: Readonly<Record<string, IgnoredRustTestManifestEntry>>;
}

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const allowedTiers = new Set<IgnoredRustTestTier>([
  "legacy-exhaustive",
  "manual",
  "performance",
  "reliability",
  "scale",
]);

const isRustFile = (entry: string): boolean => entry.endsWith(".rs");

const listRustFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return await listRustFiles(entryPath);
    return isRustFile(entry.name) ? [entryPath] : [];
  }));
  return files.flat();
};

export const findIgnoredRustTests = async (
  cratesDirectory = path.join(repositoryRoot, "crates"),
): Promise<readonly IgnoredRustTest[]> => {
  const files = await listRustFiles(cratesDirectory);
  const ignoredTests: IgnoredRustTest[] = [];
  for (const sourcePath of files) {
    const lines = (await readFile(sourcePath, "utf8")).split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const ignored = lines[lineIndex]?.match(/^\s*#\[ignore(?:\s*=\s*"([^"]*)")?\]\s*$/u);
      if (!ignored) continue;
      const functionLine = lines.slice(lineIndex + 1, lineIndex + 16)
        .find((line) => /\bfn\s+[A-Za-z0-9_]+/u.test(line));
      const name = functionLine?.match(/\bfn\s+([A-Za-z0-9_]+)/u)?.[1];
      if (!name) {
        throw new Error(`Ignored Rust test in ${sourcePath}:${lineIndex + 1} has no function declaration nearby.`);
      }
      ignoredTests.push({
        name,
        reason: ignored[1] ?? "no reason provided",
        sourcePath: path.relative(repositoryRoot, sourcePath),
      });
    }
  }
  return ignoredTests;
};

const readManifest = async (
  manifestPath: string,
): Promise<IgnoredRustTestManifest> => JSON.parse(await readFile(manifestPath, "utf8")) as IgnoredRustTestManifest;

const readPackageScripts = async (
  packagePath: string,
): Promise<Readonly<Record<string, string>>> => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    readonly scripts?: Readonly<Record<string, unknown>>;
  };
  return Object.fromEntries(
    Object.entries(packageJson.scripts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

export const verifyIgnoredRustTestManifest = async (options: {
  readonly repositoryRoot?: string;
  readonly manifestPath?: string;
  readonly packagePath?: string;
} = {}): Promise<readonly IgnoredRustTest[]> => {
  const root = options.repositoryRoot ?? repositoryRoot;
  const manifest = await readManifest(
    options.manifestPath ?? path.join(root, ".config/ci/ignored-rust-tests.json"),
  );
  const scripts = await readPackageScripts(options.packagePath ?? path.join(root, "package.json"));
  const ignoredTests = await findIgnoredRustTests(path.join(root, "crates"));
  const manifestNames = new Set(Object.keys(manifest.tests));
  const ignoredNames = new Set(ignoredTests.map((test) => test.name));

  for (const test of ignoredTests) {
    const entry = manifest.tests[test.name];
    if (!entry) throw new Error(`Ignored Rust test ${test.name} (${test.sourcePath}) has no CI tier.`);
    if (!allowedTiers.has(entry.tier)) throw new Error(`Ignored Rust test ${test.name} has an unsupported tier.`);
    const script = scripts[entry.script];
    if (!script) throw new Error(`Ignored Rust test ${test.name} references missing package script ${entry.script}.`);
    if (!script.includes(test.name) || !script.includes("--include-ignored")) {
      throw new Error(`Package script ${entry.script} is not the canonical ignored gate for ${test.name}.`);
    }
  }
  for (const manifestName of manifestNames) {
    if (!ignoredNames.has(manifestName)) throw new Error(`CI manifest names missing ignored Rust test ${manifestName}.`);
  }

  const workflowFiles = (await readdir(path.join(root, ".github/workflows")))
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"));
  for (const workflowFile of workflowFiles) {
    const workflow = await readFile(path.join(root, ".github/workflows", workflowFile), "utf8");
    for (const test of ignoredTests) {
      if (workflow.includes(test.name)) {
        throw new Error(`Workflow ${workflowFile} names ignored test ${test.name}; invoke ${manifest.tests[test.name]?.script ?? "its package script"} instead.`);
      }
    }
  }
  return ignoredTests;
};

const main = async (): Promise<void> => {
  const tests = await verifyIgnoredRustTestManifest();
  process.stdout.write(`Verified explicit CI tiers for ${tests.length} ignored Rust tests.\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
