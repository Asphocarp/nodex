import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexGitMessageGeneration, live } from "./CodexGitMessageGeneration";

it.effect("routes Git message generation to the selected host and decodes canonical output", () => {
  const requests: Array<{
    readonly hostId: string;
    readonly method: string;
    readonly params: unknown;
  }> = [];
  const gateway = CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: (hostId: string, method: string, params: unknown) =>
      Effect.sync(() => {
        requests.push({ hostId, method, params });
        return method === "generate-commit-message"
          ? { message: "  feat: generated message\n" }
          : { title: "  Generated title ", body: " Generated body\n" };
      }),
  } as unknown as CodexGateway["Service"]);
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const context = yield* Layer.buildWithScope(live, scope).pipe(
      Effect.provideService(CodexGateway, gateway),
    );
    const messages = Context.get(context, CodexGitMessageGeneration);
    assert.strictEqual(
      yield* messages.generateCommitMessage({
        hostId: "remote",
        cwd: "/workspace",
        prompt: "Changes",
      }),
      "feat: generated message",
    );
    assert.deepStrictEqual(
      yield* messages.generatePullRequestMessage({ cwd: "/workspace", prompt: "Branches" }),
      { title: "Generated title", body: "Generated body" },
    );
    assert.deepStrictEqual(
      requests.map(({ hostId, method }) => ({ hostId, method })),
      [
        { hostId: "remote", method: "generate-commit-message" },
        { hostId: "local", method: "generate-pull-request-message" },
      ],
    );
  });
});
