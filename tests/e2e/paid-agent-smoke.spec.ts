import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import {
  ElectronScenarioHarness,
  readBoundedElectronRuntimeLogs,
} from "../../scripts/scenarios/harness/electron-e2e-harness";
import {
  PAID_AGENT_SMOKE_DEFINITIONS,
  type PaidAgentSmokeCase,
} from "../../scripts/paid-agent-smoke-contract";
import { readPaidAgentRolloutEvidence } from "../../scripts/paid-agent-rollout-evidence";
import type {
  AgentExecutionProfile,
  AgentModelOption,
  AgentProviderCatalog,
  AgentProviderOption,
} from "../../src/shared/agent-runtime";
import { createBoundedOperationId } from "../../src/shared/operation-identity";
import { createUuidV7 } from "../../src/shared/uuid-v7";

const repositoryRoot = process.cwd();
const readyCredentialStatuses = new Set(["ready", "inherited", "runtimeManaged"]);
const PROFILE_STORAGE_KEY = "nodex-agent-execution-profile-v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (isRecord(value)) return value;
  throw new Error(`${label} returned no record`);
};

const requireCoreValue = (result: unknown, label: string): unknown => {
  if (isRecord(result) && result.ok === true && "value" in result) return result.value;
  const message =
    isRecord(result) && isRecord(result.error) && typeof result.error.message === "string"
      ? result.error.message
      : "unknown Core error";
  throw new Error(`${label} failed: ${message}`);
};

const invokeIpc = async (
  page: Page,
  channel: string,
  ...arguments_: readonly unknown[]
): Promise<unknown> =>
  await page.evaluate(
    async ({ targetChannel, targetArguments }) =>
      await window.api?.invoke(targetChannel, ...targetArguments),
    { targetChannel: channel, targetArguments: arguments_ },
  );

const collectRecords = (value: unknown): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!isRecord(candidate)) return;
    records.push(candidate);
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
  return records;
};

const collectReceiverThreadIds = (value: unknown): readonly string[] => {
  const receiverThreadIds = new Set<string>();
  for (const record of collectRecords(value)) {
    if (!Array.isArray(record.receiverThreadIds)) continue;
    for (const candidate of record.receiverThreadIds) {
      if (typeof candidate === "string") receiverThreadIds.add(candidate);
    }
  }
  return [...receiverThreadIds];
};

const profileFor = (
  provider: AgentProviderOption,
  model: AgentModelOption,
  reasoningEffort: string,
): AgentExecutionProfile => ({
  providerId: provider.id,
  modelId: model.modelId,
  harnessId: model.recommendedHarnessId,
  reasoningEffort,
  serviceTier: null,
});

const preflightExecutionProfile = async (
  page: Page,
  caseId: PaidAgentSmokeCase,
): Promise<{
  catalog: AgentProviderCatalog;
  expected: AgentExecutionProfile;
  model: AgentModelOption;
  provider: AgentProviderOption;
}> => {
  const definition = PAID_AGENT_SMOKE_DEFINITIONS[caseId];
  const catalog = (await invokeIpc(page, "agent-runtime:catalog:get", {
    refresh: true,
  })) as AgentProviderCatalog;
  const provider = catalog.providers.find((candidate) => candidate.id === "openai");
  if (!provider || !provider.supportedByNodex) {
    throw new Error("Paid Agent smoke requires the supported OpenAI provider");
  }
  if (!readyCredentialStatuses.has(provider.credentialStatus)) {
    throw new Error(
      `Paid Agent smoke requires a ready OpenAI credential; received ${provider.credentialStatus}`,
    );
  }
  const model = provider.models.find(
    (candidate) => !candidate.hidden && candidate.modelId === definition.modelId,
  );
  if (!model) throw new Error(`Required paid smoke model is unavailable: ${definition.modelId}`);
  if (
    !model.supportedReasoningEfforts.some((option) => option.value === definition.reasoningEffort)
  ) {
    throw new Error(
      `${definition.modelId} does not advertise ${definition.reasoningEffort} reasoning`,
    );
  }
  if (
    model.supportedServiceTiers.length > 0 &&
    !model.supportedServiceTiers.some((option) => option.value === null)
  ) {
    throw new Error(`${definition.modelId} does not advertise the Standard service tier`);
  }
  return {
    catalog,
    expected: profileFor(provider, model, definition.reasoningEffort),
    model,
    provider,
  };
};

const clickExactMenuItem = async (page: Page, text: string): Promise<void> => {
  const item = page.getByRole("menuitem").filter({ hasText: text }).last();
  await expect(item).toBeVisible();
  const label = (await item.locator("span").first().textContent())?.trim();
  if (!label?.startsWith(text)) throw new Error(`Could not resolve exact menu item ${text}`);
  await item.click();
};

const selectExecutionProfile = async (
  page: Page,
  input: Awaited<ReturnType<typeof preflightExecutionProfile>>,
): Promise<AgentExecutionProfile> => {
  const trigger = page.getByRole("button", { name: "Select model" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const providerSummary = page.locator('[aria-label^="Provider "]').last();
  if ((await providerSummary.count()) > 0) {
    const providerLabel = await providerSummary.getAttribute("aria-label");
    if (providerLabel !== `Provider ${input.provider.displayName}`) {
      await providerSummary.click();
      await clickExactMenuItem(page, input.provider.displayName);
    }
  }

  await page.locator('[aria-label^="Model "]').last().click();
  await clickExactMenuItem(page, input.model.displayName);
  await page.locator('[aria-label^="Effort "]').last().click();
  await page.locator(`[data-intelligence-option="${input.expected.reasoningEffort}"]`).click();

  const speedSummary = page.locator('[aria-label^="Speed "]').last();
  if ((await speedSummary.count()) > 0) {
    const speedLabel = await speedSummary.getAttribute("aria-label");
    if (speedLabel !== "Speed Standard") {
      await speedSummary.click();
      await clickExactMenuItem(page, "Standard");
    }
  }
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as AgentExecutionProfile) : null;
      }, PROFILE_STORAGE_KEY);
    })
    .toMatchObject({
      providerId: input.expected.providerId,
      modelId: input.expected.modelId,
      reasoningEffort: input.expected.reasoningEffort,
      serviceTier: null,
    });
  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AgentExecutionProfile) : null;
  }, PROFILE_STORAGE_KEY);
  if (!stored) throw new Error("Composer did not persist the selected execution profile");
  expect(stored).toEqual(input.expected);

  await trigger.click();
  await expect(page.getByLabel(`Model ${input.model.displayName}`)).toBeVisible();
  const effort = input.model.supportedReasoningEfforts.find(
    (option) => option.value === input.expected.reasoningEffort,
  );
  await expect(
    page.getByLabel(`Effort ${effort?.displayName ?? input.expected.reasoningEffort}`),
  ).toBeVisible();
  const visibleSpeed = page.getByLabel("Speed Standard");
  if ((await visibleSpeed.count()) > 0) await expect(visibleSpeed).toBeVisible();
  await page.keyboard.press("Escape");

  const refreshed = (await invokeIpc(page, "agent-runtime:catalog:get", {
    refresh: true,
  })) as AgentProviderCatalog;
  const refreshedProvider = refreshed.providers.find(
    (provider) => provider.id === stored.providerId,
  );
  if (
    !refreshedProvider?.supportedByNodex ||
    !readyCredentialStatuses.has(refreshedProvider.credentialStatus)
  ) {
    throw new Error("Selected provider became unavailable during final pre-send preflight");
  }
  const refreshedModel = refreshedProvider.models.find(
    (model) => !model.hidden && model.modelId === stored.modelId,
  );
  if (
    !refreshedModel?.supportedReasoningEfforts.some(
      (option) => option.value === stored.reasoningEffort,
    )
  ) {
    throw new Error("Selected execution profile disappeared during final pre-send preflight");
  }
  if (
    refreshedModel.supportedServiceTiers.length > 0 &&
    !refreshedModel.supportedServiceTiers.some((option) => option.value === stored.serviceTier)
  ) {
    throw new Error("Selected service tier disappeared during final pre-send preflight");
  }
  if (!stored.reasoningEffort) throw new Error("Paid smoke requires an explicit reasoning effort");
  expect(profileFor(refreshedProvider, refreshedModel, stored.reasoningEffort)).toEqual(stored);
  return stored;
};

const createPaidSmokeDraft = async (
  page: Page,
  workspaceRoot: string,
  caseId: PaidAgentSmokeCase,
): Promise<{ projectId: string; projectSessionId: string }> => {
  const projectName = `Paid Agent ${caseId} smoke`;
  const projectId = createUuidV7();
  const project = requireRecord(
    requireCoreValue(
      await invokeIpc(page, "projects:create", {
        operationId: createBoundedOperationId("e2e.paid-agent.project.create"),
        payload: {
          projectId,
          input: { name: projectName, sources: [workspaceRoot] },
        },
      }),
      "Paid smoke Project creation",
    ),
    "Paid smoke Project creation",
  );
  if (typeof project.id !== "string") throw new Error("Paid smoke Project returned no id");
  await page.reload();
  await page.evaluate(() => window.api?.awaitInitialization?.());
  await page.getByRole("button", { name: `Start new chat in ${projectName}`, exact: true }).click();

  let projectSessionId: string | null = null;
  await expect
    .poll(async () => {
      const window = requireRecord(
        await invokeIpc(page, "workspace:tasks:list", project.id, { first: 20 }),
        "Paid smoke task window",
      );
      if (!Array.isArray(window.items)) return "missing";
      const draft = window.items.find(
        (item) => isRecord(item) && item.projectId === project.id && item.thread === null,
      );
      projectSessionId = isRecord(draft) && typeof draft.id === "string" ? draft.id : null;
      return projectSessionId ? "ready" : "missing";
    })
    .toBe("ready");
  if (!projectSessionId) throw new Error("Paid smoke draft returned no Project Session id");
  return { projectId: project.id, projectSessionId };
};

const beginEventCapture = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __paidAgentCodexEvents?: unknown[];
      __paidAgentBrowserStates?: unknown[];
      __stopPaidAgentCodexEvents?: () => void;
      __stopPaidAgentBrowserStates?: () => void;
    };
    scope.__stopPaidAgentCodexEvents?.();
    scope.__stopPaidAgentBrowserStates?.();
    scope.__paidAgentCodexEvents = [];
    scope.__paidAgentBrowserStates = [];
    scope.__stopPaidAgentCodexEvents = window.api?.on("codex:event", (event: unknown) => {
      scope.__paidAgentCodexEvents?.push(event);
    });
    scope.__stopPaidAgentBrowserStates = window.api?.on(
      "browser-sidebar-browser-use-state",
      (state: unknown) => scope.__paidAgentBrowserStates?.push(state),
    );
  });
};

const capturedEvents = async (
  page: Page,
): Promise<{ browserStates: unknown[]; codexEvents: unknown[] }> =>
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __paidAgentCodexEvents?: unknown[];
      __paidAgentBrowserStates?: unknown[];
    };
    return {
      browserStates: scope.__paidAgentBrowserStates ?? [],
      codexEvents: scope.__paidAgentCodexEvents ?? [],
    };
  });

const sendPrompt = async (
  page: Page,
  projectSessionId: string,
  prompt: string,
): Promise<string> => {
  const composer = page.locator('[data-codex-composer="true"][aria-label="Do anything"]');
  await expect(composer).toBeVisible();
  await composer.fill(prompt);
  await expect(composer).toHaveText(prompt);
  const sendButton = page.getByRole("button", { name: "Send prompt" });
  await expect(sendButton).toBeEnabled();
  await beginEventCapture(page);
  await sendButton.click();

  let threadId: string | null = null;
  await expect
    .poll(
      async () => {
        const session = await invokeIpc(page, "project-sessions:get", projectSessionId);
        if (!isRecord(session) || !isRecord(session.thread)) return "missing";
        threadId = typeof session.thread.threadId === "string" ? session.thread.threadId : null;
        return threadId ? "linked" : "missing";
      },
      { timeout: 45_000 },
    )
    .toBe("linked");
  if (!threadId) throw new Error("Paid smoke turn returned no thread id");
  return threadId;
};

const waitForFinalMarker = async (page: Page, marker: string): Promise<void> => {
  await expect(page.getByText(marker, { exact: false }).last()).toBeVisible({ timeout: 150_000 });
};

const readCompletedThreadEvidence = async (
  page: Page,
  threadId: string,
  expectedProfile: AgentExecutionProfile,
): Promise<{ snapshot: unknown; summary: Record<string, unknown> }> => {
  await expect
    .poll(
      async () => {
        const value = await invokeIpc(page, "codex:thread:summary:get", threadId);
        return isRecord(value) ? value.statusType : null;
      },
      { timeout: 30_000 },
    )
    .toBe("idle");
  const summary = requireRecord(
    await invokeIpc(page, "codex:thread:summary:get", threadId),
    "Paid smoke durable summary",
  );
  expect(summary.executionProfile).toEqual(expectedProfile);
  const snapshot = await invokeIpc(page, "codex:thread:snapshot:request", threadId);
  const snapshotRecord = requireRecord(snapshot, "Paid smoke thread snapshot");
  expect(Array.isArray(snapshotRecord.turns) ? snapshotRecord.turns.length : 0).toBe(1);
  return { snapshot, summary };
};

const digest = (contents: Buffer | string): string =>
  createHash("sha256").update(contents).digest("hex");

interface PaidCaseContext {
  readonly childThreadIds: readonly string[];
  readonly codexHome: string;
  readonly page: Page;
  readonly profile: AgentExecutionProfile;
  readonly projectSessionId: string;
  readonly threadId: string;
}

const runPaidCase = async (
  caseId: PaidAgentSmokeCase,
  prompt: string,
  marker: string,
  testInfo: TestInfo,
  verify: (context: PaidCaseContext & { snapshot: unknown }) => Promise<Record<string, unknown>>,
  beforeSend: (context: { readonly page: Page }) => Promise<void> = async () => undefined,
): Promise<void> => {
  const sourceCodexHome = process.env.NODEX_PAID_AGENT_SMOKE_SOURCE_CODEX_HOME;
  if (!sourceCodexHome)
    throw new Error("Use `vp run agent:smoke:paid --case ...` to run this test");
  const harness = await ElectronScenarioHarness.create({
    label: `paid-agent-${caseId}`,
    codex: "empty",
    cwd: repositoryRoot,
    prepareAgentRuntime: false,
    environment: { NODEX_LOG_FILE: "1", NODEX_LOG_CONSOLE: "0" },
  });
  const copiedAuthPath = path.join(harness.profile.codexHome, "auth.json");
  const diagnostics: string[] = [];
  const startedAt = Date.now();
  let page: Page | null = null;
  let result: Record<string, unknown> = {};
  let failure: unknown;
  try {
    fs.copyFileSync(path.join(sourceCodexHome, "auth.json"), copiedAuthPath);
    fs.chmodSync(copiedAuthPath, 0o600);
    page = await harness.launch();
    page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
    });
    const draft = await createPaidSmokeDraft(
      page,
      harness.profile.initialProjectsDirectory,
      caseId,
    );
    const preflight = await preflightExecutionProfile(page, caseId);
    const selectedProfile = await selectExecutionProfile(page, preflight);
    await beforeSend({ page });
    const threadId = await sendPrompt(page, draft.projectSessionId, prompt);
    await waitForFinalMarker(page, marker);
    const completed = await readCompletedThreadEvidence(page, threadId, selectedProfile);
    const childThreadIds = collectReceiverThreadIds(completed.snapshot);
    expect(childThreadIds).toHaveLength(
      PAID_AGENT_SMOKE_DEFINITIONS[caseId].maximumAgentExecutions - 1,
    );
    const rollout = await readPaidAgentRolloutEvidence(harness.profile.codexHome, threadId);
    expect(rollout).not.toBeNull();
    expect(rollout?.modelProvider).toBe("openai");
    expect(rollout?.turnContexts).toHaveLength(1);
    expect(rollout?.turnContexts[0]).toMatchObject({
      model: selectedProfile.modelId,
      effort: selectedProfile.reasoningEffort,
    });
    result = {
      schemaVersion: 1,
      case: caseId,
      maximumAgentExecutions: PAID_AGENT_SMOKE_DEFINITIONS[caseId].maximumAgentExecutions,
      executionProfile: selectedProfile,
      projectSessionId: draft.projectSessionId,
      threadId,
      rollout,
      ...(await verify({
        childThreadIds,
        codexHome: harness.profile.codexHome,
        page,
        profile: selectedProfile,
        projectSessionId: draft.projectSessionId,
        snapshot: completed.snapshot,
        threadId,
      })),
    };
    expect(diagnostics).toEqual([]);
  } catch (error) {
    failure = error;
  }

  let evidenceFailure: unknown;
  let credentialScrubFailure: unknown;
  let cleanupFailure: unknown;
  try {
    if (page) {
      await page
        .screenshot({ path: testInfo.outputPath("final.png"), fullPage: true })
        .catch(() => undefined);
    }
    await harness.stopElectron().catch((error) => diagnostics.push(`shutdown: ${String(error)}`));
    const runtimeLogs = await readBoundedElectronRuntimeLogs(harness.profile).catch(
      (error) => `Could not read runtime logs: ${String(error)}\n`,
    );
    const evidence = {
      ...result,
      durationMs: Date.now() - startedAt,
      diagnostics,
      failed: Boolean(failure),
    };
    fs.writeFileSync(
      testInfo.outputPath("evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    await testInfo.attach("paid-agent-smoke-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("paid-agent-runtime-logs", {
      body: runtimeLogs,
      contentType: "text/plain",
    });
  } catch (error) {
    evidenceFailure = error;
  } finally {
    try {
      fs.rmSync(copiedAuthPath, { force: true });
    } catch (error) {
      credentialScrubFailure = error;
    }
    try {
      await harness.close();
    } catch (error) {
      cleanupFailure = error;
    }
  }
  const failures = [failure, evidenceFailure, credentialScrubFailure, cleanupFailure].filter(
    (candidate) => candidate !== undefined,
  );
  if (failures.length > 1) throw new AggregateError(failures, "Paid Agent smoke failed");
  if (failures.length === 1) throw failures[0];
};

test("creates and verifies exact file bytes @paid-agent-file", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const token = randomUUID();
  const marker = `PAID_FILE_SMOKE_OK_${token}`;
  const fileContents = `NODEX_PAID_FILE_SMOKE_${token}\n`;
  const filePath = path.join("/tmp", `nodex-paid-file-smoke-${token}.txt`);
  try {
    await runPaidCase(
      "file",
      `Use a file-editing or shell tool to create exactly ${filePath} with the exact UTF-8 contents ${JSON.stringify(fileContents)}. Read it back with a tool to verify the exact bytes. Do not modify any other file. Finish with the exact marker ${marker}.`,
      marker,
      testInfo,
      async ({ snapshot }) => {
        const bytes = fs.readFileSync(filePath);
        expect(bytes.equals(Buffer.from(fileContents))).toBe(true);
        const toolTypes = collectRecords(snapshot)
          .map((record) => record.type)
          .filter((type): type is string => typeof type === "string");
        expect(toolTypes.some((type) => type === "commandExecution" || type === "fileChange")).toBe(
          true,
        );
        return { file: { byteLength: bytes.length, sha256: digest(bytes) }, marker };
      },
    );
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

const startBrowserFixture = async (
  marker: string,
): Promise<{
  close: () => Promise<void>;
  requests: string[];
  url: string;
}> => {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(`<html><head><title>${marker}</title></head><body>${marker}</body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser fixture returned no port");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/paid-browser-smoke`,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

test("opens a local fixture through Browser Use @paid-agent-browser", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const token = randomUUID();
  const pageMarker = `NODEX_BROWSER_FIXTURE_${token}`;
  const finalMarker = `PAID_BROWSER_SMOKE_OK_${token}`;
  const fixture = await startBrowserFixture(pageMarker);
  try {
    await runPaidCase(
      "browser",
      `Use the in-app Browser tool to open ${fixture.url}, read the visible page token, and report it. Do not use shell, curl, web search, or a direct fetch. Finish with the exact marker ${finalMarker}.`,
      finalMarker,
      testInfo,
      async ({ page, projectSessionId, snapshot, threadId }) => {
        expect(fixture.requests).toContain("/paid-browser-smoke");
        const events = await capturedEvents(page);
        const browserTabs = events.browserStates.flatMap((state) =>
          isRecord(state) && Array.isArray(state.tabs) ? state.tabs : [],
        );
        expect(
          browserTabs.some(
            (tab) =>
              isRecord(tab) &&
              tab.url === fixture.url &&
              (tab.codexSessionId === threadId || tab.codexSessionId === projectSessionId),
          ),
        ).toBe(true);
        const browserMcpItems = collectRecords(snapshot).filter((record) => {
          if (record.type !== "mcpToolCall" || !isRecord(record.mcpToolCall)) return false;
          const source = record.mcpToolCall.source;
          return isRecord(source) && source.kind === "browserUse" && source.backend === "iab";
        });
        expect(browserMcpItems.length).toBeGreaterThan(0);
        return {
          browser: {
            targetOrigin: new URL(fixture.url).origin,
            targetPathObserved: true,
            browserUseStateObserved: true,
            completedMcpItemCount: browserMcpItems.length,
          },
          finalMarker,
          pageMarker,
        };
      },
      async ({ page }) => {
        await invokeIpc(page, "browser-use-policy-update-origin-rule", {
          action: "add",
          kind: "allowed",
          origin: new URL(fixture.url).origin,
          resource: "origin",
        });
      },
    );
  } finally {
    await fixture.close();
  }
});

test("spawns exactly one child and converges to Done @paid-agent-subagent", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const token = randomUUID();
  const childContents = `NODEX_PAID_SUBAGENT_${token}\n`;
  const childPath = path.join("/tmp", `nodex-paid-subagent-smoke-${token}.txt`);
  const finalMarker = `PAID_SUBAGENT_SMOKE_OK_${token}`;
  try {
    await runPaidCase(
      "subagent",
      `Spawn exactly one subagent. Ask that child to create ${childPath} with exact UTF-8 contents ${JSON.stringify(childContents)}, verify the file with a tool, and report CHILD_DONE_${token}. Wait for that child to finish. Do not spawn any other subagent. Then finish with the exact marker ${finalMarker}.`,
      finalMarker,
      testInfo,
      async ({ childThreadIds, codexHome, page, threadId }) => {
        const bytes = fs.readFileSync(childPath);
        expect(bytes.equals(Buffer.from(childContents))).toBe(true);
        const childThreadId = childThreadIds[0];
        if (!childThreadId) throw new Error("Subagent smoke returned no child thread id");

        await expect
          .poll(
            async () => {
              const value = await invokeIpc(page, "codex:subagents:overview:read", {
                rootThreadId: threadId,
                mode: "expanded",
              });
              if (!isRecord(value) || !isRecord(value.active) || !isRecord(value.done)) return null;
              return {
                active: value.active.knownCount,
                completeness: value.completeness,
                done: value.done.knownCount,
              };
            },
            { timeout: 30_000 },
          )
          .toEqual({ active: 0, completeness: "complete", done: 1 });
        const overview = await invokeIpc(page, "codex:subagents:overview:read", {
          rootThreadId: threadId,
          mode: "expanded",
        });
        const activeRows =
          isRecord(overview) && isRecord(overview.active) ? overview.active.rows : null;
        const doneRows = isRecord(overview) && isRecord(overview.done) ? overview.done.rows : null;
        expect(activeRows).toEqual([]);
        expect(doneRows).toEqual([
          expect.objectContaining({
            threadId: childThreadId,
            parentThreadId: threadId,
            status: "done",
          }),
        ]);
        const events = await capturedEvents(page);
        expect(
          events.codexEvents.some(
            (event) =>
              isRecord(event) &&
              event.type === "subagentOverviewInvalidated" &&
              event.rootThreadId === threadId,
          ),
        ).toBe(true);
        const childRollout = await readPaidAgentRolloutEvidence(codexHome, childThreadId);
        return {
          child: {
            threadId: childThreadId,
            byteLength: bytes.length,
            sha256: digest(bytes),
            rolloutObserved: childRollout !== null,
          },
          finalMarker,
          topology: overview,
        };
      },
    );
  } finally {
    fs.rmSync(childPath, { force: true });
  }
});
