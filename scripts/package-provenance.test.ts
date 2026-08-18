import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  verifyPackagedBuildProvenance,
  writePackagedBuildProvenance,
} from "./package-provenance.mjs";

const temporaryRoots: string[] = [];
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const skillFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/nested-markdown.md",
  "references/page-editor.md",
  "references/project-database-views.md",
  "references/troubleshooting.md",
] as const;

const writeAgentSkills = (
  resources: string,
): { manifestSha256: string; treeSha256: string } => {
  const root = path.join(resources, "agent-skills");
  const files = new Map(
    skillFiles.map((relativePath) => [
      relativePath,
      Buffer.from(`${relativePath}\n`, "utf8"),
    ]),
  );
  const hash = createHash("sha256");
  for (const relativePath of [...files.keys()].sort()) {
    const contents = files.get(relativePath);
    if (!contents) throw new Error(`Missing test Skill file: ${relativePath}`);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(contents.byteLength));
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  const treeSha256 = hash.digest("hex");
  for (const [relativePath, contents] of files) {
    const destination = path.join(root, "skills/nodex", relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }
  fs.writeFileSync(path.join(root, "README.md"), "README\n");
  fs.writeFileSync(path.join(root, "LICENSE"), "LICENSE\n");
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    distribution: "NodexApp/skills",
    product: { name: "Nodex", releaseVersion: "0.1.10" },
    source: { repository: "NodexApp/nodex", ref: "v0.1.10" },
    agentInterface: { minimumRevision: 1, maximumRevision: 1 },
    skills: [{
      name: "nodex",
      path: "skills/nodex",
      treeSha256,
      fileCount: files.size,
      totalBytes: [...files.values()]
        .reduce((total, contents) => total + contents.byteLength, 0),
    }],
  }, null, 2)}\n`;
  fs.writeFileSync(path.join(root, "release-manifest.json"), manifest);
  return { manifestSha256: sha256(manifest), treeSha256 };
};

const makePreparedManifest = (
  agentSkills: { manifestSha256: string; treeSha256: string },
  inputDigest = "1".repeat(64),
): object => {
  const body = {
    agentSkills,
    buildContext: { arch: "arm64", platform: "darwin" },
    inputDigest,
    outputs: [{
      executable: false,
      path: "out/main/bootstrap.js",
      sha256: "2".repeat(64),
      size: 10,
    }],
    product: { name: "nodex", version: "0.1.10" },
    schemaVersion: 3,
    source: {
      baseCommit: "3".repeat(40),
      baseTree: "4".repeat(40),
      snapshotDigest: inputDigest,
      state: "clean",
    },
  };
  return {
    ...body,
    generationId: sha256(JSON.stringify(body)),
  };
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const refreshBrowserProvenanceIdentity = (appPath: string): void => {
  const browserManifestPath = path.join(
    appPath,
    "Contents/Resources/browser-runtime/browser-runtime-manifest.json",
  );
  const browserContents = fs.readFileSync(browserManifestPath);
  const provenancePath = path.join(
    appPath,
    "Contents/Resources/nodex-build-provenance.json",
  );
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as {
    payload: { browserRuntimeManifest: unknown };
    provenanceId?: string;
    [key: string]: unknown;
  };
  provenance.payload.browserRuntimeManifest = {
    path: "browser-runtime/browser-runtime-manifest.json",
    sha256: sha256(browserContents.toString("utf8")),
    size: browserContents.byteLength,
  };
  delete provenance.provenanceId;
  provenance.provenanceId = sha256(stableJson(provenance));
  writeJson(provenancePath, provenance);
};

const writeSparkleRuntime = (appPath: string): void => {
  const artifactPaths = {
    autoupdate: "Frameworks/Sparkle.framework/Versions/B/Autoupdate",
    bridge: "Resources/native/nodex-sparkle.node",
    frameworkExecutable: "Frameworks/Sparkle.framework/Versions/B/Sparkle",
    frameworkInfoPlist: "Frameworks/Sparkle.framework/Versions/B/Resources/Info.plist",
    updater: "Frameworks/Sparkle.framework/Versions/B/Updater.app/Contents/MacOS/Updater",
  };
  const artifacts = Object.fromEntries(Object.entries(artifactPaths).map(([
    name,
    relativePath,
  ]) => {
    const filePath = path.join(appPath, "Contents", relativePath);
    const contents = Buffer.from(`${name}\n`, "utf8");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, { mode: name === "frameworkInfoPlist" ? 0o644 : 0o755 });
    return [name, {
      path: relativePath,
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: contents.length,
    }];
  }));
  writeJson(path.join(appPath, "Contents/Resources/native/sparkle-runtime.json"), {
    artifacts,
    architecture: "arm64",
    channel: "stable",
    feedUrl: "https://nodex.jyu.app/updates/stable/arm64/appcast.xml",
    minimumMacOS: "12.0",
    publicKey: "YNySLZ74gjVAOpEdMo9OOEPvuTEMZf8fMnI+oQD7Ifs=",
    schemaVersion: 2,
    sparkleArchiveSha256: "6".repeat(64),
    sparkleVersion: "2.9.4",
  });
};

const makeApp = (): {
  appPath: string;
  currentPreparedPath: string;
} => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-package-provenance-"));
  temporaryRoots.push(root);
  const appPath = path.join(root, "Nodex.app");
  const resources = path.join(appPath, "Contents/Resources");
  fs.mkdirSync(path.join(resources, "bin"), { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), "current app payload\n");
  writeSparkleRuntime(appPath);
  const agentSkills = writeAgentSkills(resources);
  const prepared = makePreparedManifest(agentSkills);
  writeJson(path.join(resources, "prepared-electron-build.json"), prepared);
  writeJson(path.join(resources, "bin/rust-core-runtime.json"), {
    schemaVersion: 3,
    productVersion: "0.1.10",
    targetPlatform: "darwin",
    targetArch: "arm64",
  });
  writeJson(path.join(resources, "agent-runtime.json"), {
    layoutVersion: 3,
    targetPlatform: "darwin",
    targetArch: "arm64",
  });
  const currentPreparedPath = path.join(root, "current-prepared.json");
  writeJson(currentPreparedPath, prepared);
  return { appPath, currentPreparedPath };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("packaged build provenance", () => {
  test("binds app.asar and both runtime manifests to the prepared source generation", () => {
    const fixture = makeApp();
    const written = writePackagedBuildProvenance(fixture.appPath);

    const verified = verifyPackagedBuildProvenance(fixture.appPath, {
      expectedArch: "arm64",
      expectedPreparedManifestPath: fixture.currentPreparedPath,
    });

    expect(verified.provenanceId).toBe(written.provenanceId);
  });

  test("binds the optional Browser runtime manifest when one is packaged", () => {
    const fixture = makeApp();
    const browserManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/browser-runtime/browser-runtime-manifest.json",
    );
    const agentManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/agent-runtime.json",
    );
    writeJson(agentManifestPath, {
      codexCompatibilityVersion: "0.146.0",
      layoutVersion: 3,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    writeJson(browserManifestPath, {
      codexCompatibilityVersion: "0.146.0",
      schemaVersion: 1,
      targetArch: "arm64",
      targetPlatform: "darwin",
      runtimeVersions: {
        codexCli: "0.148.0-alpha.9",
      },
    });
    writePackagedBuildProvenance(fixture.appPath);
    fs.appendFileSync(browserManifestPath, "tampered\n");

    expect(() => verifyPackagedBuildProvenance(fixture.appPath)).toThrow(
      "does not match the packaged provenance",
    );
  });

  test("rejects a Browser runtime outside the compatibility window before sealing provenance", () => {
    const fixture = makeApp();
    const browserManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/browser-runtime/browser-runtime-manifest.json",
    );
    const agentManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/agent-runtime.json",
    );
    writeJson(agentManifestPath, {
      codexCompatibilityVersion: "0.147.0",
      layoutVersion: 3,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    writeJson(browserManifestPath, {
      codexCompatibilityVersion: "0.146.0",
      runtimeVersions: { codexCli: "0.146.0" },
      schemaVersion: 1,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });

    expect(() => writePackagedBuildProvenance(fixture.appPath)).toThrow(
      "targets do not agree",
    );
  });

  test("rejects a Browser runtime that drifts outside the compatibility window during verification", () => {
    const fixture = makeApp();
    const browserManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/browser-runtime/browser-runtime-manifest.json",
    );
    const agentManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/agent-runtime.json",
    );
    writeJson(agentManifestPath, {
      codexCompatibilityVersion: "0.147.0",
      layoutVersion: 3,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    writeJson(browserManifestPath, {
      codexCompatibilityVersion: "0.146.0",
      runtimeVersions: { codexCli: "0.148.0-alpha.9" },
      schemaVersion: 1,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    writePackagedBuildProvenance(fixture.appPath);
    writeJson(browserManifestPath, {
      codexCompatibilityVersion: "0.146.0",
      runtimeVersions: { codexCli: "0.146.0" },
      schemaVersion: 1,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    refreshBrowserProvenanceIdentity(fixture.appPath);

    expect(() => verifyPackagedBuildProvenance(fixture.appPath)).toThrow(
      "target does not match provenance",
    );
  });

  test("rejects a stale prepared source generation", () => {
    const fixture = makeApp();
    writePackagedBuildProvenance(fixture.appPath);
    const agentSkills = writeAgentSkills(
      path.join(fixture.appPath, "Contents/Resources"),
    );
    writeJson(
      fixture.currentPreparedPath,
      makePreparedManifest(agentSkills, "5".repeat(64)),
    );

    expect(() => verifyPackagedBuildProvenance(fixture.appPath, {
      expectedPreparedManifestPath: fixture.currentPreparedPath,
    })).toThrow("stale for the current prepared Electron source");
  });

  test("rejects native/app version drift before sealing provenance", () => {
    const fixture = makeApp();
    const nativeManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/bin/rust-core-runtime.json",
    );
    writeJson(nativeManifestPath, {
      schemaVersion: 3,
      productVersion: "0.2.0",
      targetPlatform: "darwin",
      targetArch: "arm64",
    });

    expect(() => writePackagedBuildProvenance(fixture.appPath)).toThrow("targets do not agree");
  });

  test.each([
    "app.asar",
    "bin/rust-core-runtime.json",
    "agent-runtime.json",
    "native/nodex-sparkle.node",
  ])("rejects a packaged payload mutation in %s", (relativePath) => {
    const fixture = makeApp();
    writePackagedBuildProvenance(fixture.appPath);
    fs.appendFileSync(
      path.join(fixture.appPath, "Contents/Resources", relativePath),
      "tampered\n",
    );

    expect(() => verifyPackagedBuildProvenance(fixture.appPath)).toThrow(
      "does not match the packaged provenance",
    );
  });

  test("rejects a mutated packaged official Agent Skill", () => {
    const fixture = makeApp();
    writePackagedBuildProvenance(fixture.appPath);
    fs.appendFileSync(
      path.join(
        fixture.appPath,
        "Contents/Resources/agent-skills/skills/nodex/SKILL.md",
      ),
      "tampered\n",
    );

    expect(() => verifyPackagedBuildProvenance(fixture.appPath)).toThrow(
      "tree does not match its release manifest",
    );
  });
});
