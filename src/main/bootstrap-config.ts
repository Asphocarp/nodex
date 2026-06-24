import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

interface BootstrapServerTomlConfig {
  dir?: string;
}

interface BootstrapRootTomlConfig extends Record<string, unknown> {
  server?: BootstrapServerTomlConfig;
}

export interface ResolveBootstrapLocalStoreDirOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
}

function readServerSection(
  configPath: string,
  readFile: (filePath: string) => string,
): BootstrapServerTomlConfig | null {
  try {
    const parsed = parseToml(readFile(configPath)) as BootstrapRootTomlConfig;
    return parsed.server ?? null;
  } catch {
    return null;
  }
}

function findProjectConfig(
  cwd: string,
  exists: (filePath: string) => boolean,
): string | null {
  let dir = cwd;
  for (;;) {
    const candidate = path.join(dir, ".nodex", "config.toml");
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function expandTilde(inputPath: string, homeDir: string): string {
  if (inputPath === "~" || inputPath.startsWith("~/")) {
    return path.join(homeDir, inputPath.slice(1));
  }
  return inputPath;
}

export function resolveBootstrapLocalStoreDir(options: ResolveBootstrapLocalStoreDirOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const envHome = env.HOME?.trim();
  const homeDir = options.homeDir ?? (envHome ? envHome : homedir());
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? ((filePath) => readFileSync(filePath, "utf8"));

  const envDir = env.NODEX_DIR?.trim();
  if (envDir) {
    return path.isAbsolute(envDir) ? envDir : path.resolve(cwd, envDir);
  }

  const mergedConfig: BootstrapServerTomlConfig = {};
  const userConfig = path.join(homeDir, ".nodex", "config.toml");
  if (exists(userConfig)) {
    Object.assign(mergedConfig, readServerSection(userConfig, readFile) ?? {});
  }

  const projectConfig = findProjectConfig(cwd, exists);
  if (projectConfig) {
    Object.assign(mergedConfig, readServerSection(projectConfig, readFile) ?? {});
  }

  if (mergedConfig.dir) {
    const expanded = expandTilde(mergedConfig.dir, homeDir);
    return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  }

  return path.join(homeDir, ".nodex");
}
