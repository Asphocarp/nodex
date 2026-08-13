import { isAbsolute, join } from "node:path";

export function resolveNodexProjectsDirectory(
  documentsDirectory: string,
): string {
  if (!isAbsolute(documentsDirectory)) {
    throw new Error("Electron Documents directory must be absolute");
  }
  return join(documentsDirectory, "Nodex");
}
