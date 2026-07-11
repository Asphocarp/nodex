import { describe, expect, test } from "vitest";
import {
  buildCodexGrantedPermissionProfile,
  buildCodexPermissionRequestDetails,
  formatCodexPermissionPath,
  resolveCodexPermissionRequestTitleModel,
} from "./codex-permission-request";

describe("codex permission request helpers", () => {
  test("normalizes network and legacy filesystem permissions into display details", () => {
    const details = buildCodexPermissionRequestDetails({
      network: { enabled: true },
      fileSystem: {
        read: ["/repo", "/repo/shared"],
        write: ["/repo", "/tmp/out"],
      },
    });

    expect(JSON.stringify(details)).toBe(JSON.stringify([
      { kind: "network" },
      { kind: "fileSystem", access: "readWrite", paths: ["/repo"] },
      { kind: "fileSystem", access: "read", paths: ["/repo/shared"] },
      { kind: "fileSystem", access: "write", paths: ["/tmp/out"] },
    ]));
  });

  test("uses entries as the canonical filesystem source and ignores deny entries", () => {
    const details = buildCodexPermissionRequestDetails({
      network: null,
      fileSystem: {
        read: ["/legacy"],
        write: ["/legacy"],
        entries: [
          { path: { type: "path", path: "/repo" }, access: "read" },
          { path: { type: "path", path: "/repo" }, access: "write" },
          { path: { type: "glob_pattern", pattern: "/repo/**/*.ts" }, access: "read" },
          { path: { type: "path", path: "/secret" }, access: "deny" },
        ],
      },
    });

    expect(JSON.stringify(details)).toBe(JSON.stringify([
      { kind: "fileSystem", access: "readWrite", paths: ["/repo"] },
      { kind: "fileSystem", access: "read", paths: ["/repo/**/*.ts"] },
    ]));
  });

  test("formats special filesystem paths the same way as the reference model", () => {
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "root" } })).toBe("/");
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "minimal" } })).toBe(":minimal");
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "project_roots", subpath: null } })).toBe(":project_roots");
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "project_roots", subpath: "src" } })).toBe(":project_roots/src");
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "tmpdir" } })).toBe(":tmpdir");
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "slash_tmp" } })).toBe("/tmp");
    expect(formatCodexPermissionPath({ type: "special", value: { kind: "unknown", path: "/var", subpath: "log" } })).toBe("/var/log");
  });

  test("resolves single-detail titles and granted permission responses", () => {
    expect(JSON.stringify(resolveCodexPermissionRequestTitleModel([{ kind: "network" }]))).toBe(
      JSON.stringify({ kind: "network" }),
    );
    expect(JSON.stringify(resolveCodexPermissionRequestTitleModel([{
      kind: "fileSystem",
      access: "write",
      paths: ["/repo/out"],
    }]))).toBe(JSON.stringify({ kind: "fileSystem", access: "write", path: "/repo/out" }));
    expect(JSON.stringify(resolveCodexPermissionRequestTitleModel([
      { kind: "network" },
      { kind: "fileSystem", access: "read", paths: ["/repo"] },
    ]))).toBe(JSON.stringify({ kind: "additional" }));

    expect(JSON.stringify(buildCodexGrantedPermissionProfile({
      network: null,
      fileSystem: {
        read: ["/repo"],
        write: null,
      },
    }))).toBe(JSON.stringify({
      fileSystem: {
        read: ["/repo"],
        write: null,
      },
    }));
  });
});
