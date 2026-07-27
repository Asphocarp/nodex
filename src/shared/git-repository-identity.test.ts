import { describe, expect, it } from "vitest";
import { parseGitRepositoryOwnerRepo } from "./git-repository-identity";

describe("parseGitRepositoryOwnerRepo", () => {
  it.each([
    ["https://github.com/openai/codex.git", { owner: "openai", repo: "codex" }],
    ["ssh://git@github.com:2222/openai/codex.git", { owner: "openai", repo: "codex" }],
    ["git@github.com:openai/codex.git", { owner: "openai", repo: "codex" }],
    ["https://gitlab.example.com/product/tools/nodex", { owner: "product/tools", repo: "nodex" }],
    ["git://example.com/team/repo.with-punctuation.git", {
      owner: "team",
      repo: "repo.with-punctuation",
    }],
    ["git@example.com:acme/private.git?token=hidden", {
      owner: "acme",
      repo: "private",
    }],
  ])("parses %s", (remoteUrl, expected) => {
    expect(parseGitRepositoryOwnerRepo(remoteUrl)).toEqual(expected);
  });

  it.each([
    null,
    "",
    "not a remote",
    "/Users/example/repository",
    "file:///Users/example/repository",
    "C:\\repository",
  ])("returns null for %s", (remoteUrl) => {
    expect(parseGitRepositoryOwnerRepo(remoteUrl)).toBeNull();
  });
});
