import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  codexClientThreadIdentityAtomKey,
  getCodexClientThreadId,
  listCodexClientThreadIdentities,
  resolveCodexThreadIdForClientThreadId,
  setCodexClientThreadIdentity,
} from "./codex-client-thread-identity";
import {
  resetPersistedAtomStateForTests,
  setPersistedAtomsPathOverrideForTests,
  updatePersistedAtom,
} from "../local-store/persisted-atoms";

const tempDirectories: string[] = [];

function useTempPersistedAtoms(): void {
  const directory = mkdtempSync(join(tmpdir(), "nodex-client-thread-identity-"));
  tempDirectories.push(directory);
  setPersistedAtomsPathOverrideForTests(join(directory, "persisted-atoms-v1.json"));
}

describe("Codex client-thread identity", () => {
  afterEach(() => {
    setPersistedAtomsPathOverrideForTests(null);
    resetPersistedAtomStateForTests();
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("persists the exact conversation-scoped atom and resolves both directions", () => {
    useTempPersistedAtoms();
    const clientThreadId = "client-new-thread:11111111-1111-4111-8111-111111111111";

    expect(
      setCodexClientThreadIdentity({
        hostId: "local",
        threadId: "conversation with spaces",
        clientThreadId,
      }),
    ).toBe(true);
    expect(codexClientThreadIdentityAtomKey("local", "conversation with spaces")).toBe(
      "thread-client-id-v1:local%3Aconversation%20with%20spaces",
    );
    resetPersistedAtomStateForTests();
    expect(getCodexClientThreadId("local", "conversation with spaces")).toBe(clientThreadId);
    expect(resolveCodexThreadIdForClientThreadId("local", clientThreadId)).toBe(
      "conversation with spaces",
    );
  });

  test("lists only current conversations and ignores invalid persisted client ids", () => {
    useTempPersistedAtoms();
    setCodexClientThreadIdentity({
      hostId: "local",
      threadId: "current",
      clientThreadId: "client-new-thread:current",
    });
    setCodexClientThreadIdentity({
      hostId: "local",
      threadId: "stale",
      clientThreadId: "client-new-thread:stale",
    });
    updatePersistedAtom({
      key: codexClientThreadIdentityAtomKey("local", "invalid"),
      value: "not-a-client-thread",
    });

    expect(JSON.stringify(listCodexClientThreadIdentities("local", ["current", "invalid"]))).toBe(
      '[{"hostId":"local","threadId":"current","clientThreadId":"client-new-thread:current"}]',
    );
    expect(getCodexClientThreadId("local", "invalid")).toBe(null);
  });

  test("rejects blank identities and client ids outside the exact namespace", () => {
    useTempPersistedAtoms();
    expect(
      setCodexClientThreadIdentity({
        hostId: "local",
        threadId: "thread",
        clientThreadId: "thread",
      }),
    ).toBe(false);
    expect(
      setCodexClientThreadIdentity({
        hostId: " ",
        threadId: "thread",
        clientThreadId: "client-new-thread:value",
      }),
    ).toBe(false);
  });
});
