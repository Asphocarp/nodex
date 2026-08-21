import path from "node:path";

export interface ResolveNodexHomePathOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  userHome: string;
  configuredHome?: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(cwd, inputPath);
}

function expandConfiguredHome(inputPath: string, userHome: string): string {
  if (inputPath === "~" || inputPath.startsWith("~/")) {
    return path.join(userHome, inputPath.slice(1));
  }
  return inputPath;
}

export function resolveNodexHomePath(options: ResolveNodexHomePathOptions): string {
  const environmentHome = options.env.NODEX_HOME?.trim();
  if (environmentHome) {
    return resolvePath(environmentHome, options.cwd);
  }

  const configuredHome = options.configuredHome?.trim();
  if (configuredHome) {
    return resolvePath(expandConfiguredHome(configuredHome, options.userHome), options.cwd);
  }

  return path.join(options.userHome, ".nodex");
}
