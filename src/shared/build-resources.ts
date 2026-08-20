import path from "node:path";

export const BUILD_RESOURCES_DIRECTORY = ".generated/build-resources";
export const BUILD_RESOURCES_MANIFEST_FILENAME = "manifest.json";

export interface BuildResourcesPaths {
  readonly manifestPath: string;
  readonly noticesPath: string;
  readonly root: string;
}

const pathsForRoot = (root: string): BuildResourcesPaths => ({
  manifestPath: path.join(root, BUILD_RESOURCES_MANIFEST_FILENAME),
  noticesPath: path.join(root, "THIRD_PARTY_NOTICES.txt"),
  root,
});

export function buildResourcesPathsAtRoot(root: string): BuildResourcesPaths {
  return pathsForRoot(path.resolve(root));
}

export function resolveBuildResources(root: string): BuildResourcesPaths {
  const resolved = path.resolve(root);
  const resourceRoot = path.basename(resolved) === path.basename(BUILD_RESOURCES_DIRECTORY)
    ? resolved
    : path.join(resolved, BUILD_RESOURCES_DIRECTORY);
  return buildResourcesPathsAtRoot(resourceRoot);
}
