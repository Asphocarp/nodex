import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { VoiceSettingsPage } from "./voice-settings-page";

const mocks = vi.hoisted(() => ({
  requestInputMonitoring: vi.fn(),
  requestAccessibility: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  deleteDictationRecording: vi.fn(),
  downloadDictationRecording: vi.fn(),
  listDictationRecordings: async () => [],
  openGlobalDictationAccessibilitySettings: vi.fn(),
  openGlobalDictationInputMonitoringSettings: vi.fn(),
  openMicrophoneSettings: vi.fn(),
  readDictationCapabilityState: async () => ({
    isEnabled: false,
    authMethod: "apiKey",
    shortcutLabel: "Ctrl+M",
    capabilities: {
      composer: false,
      global: false,
      history: true,
      streaming: "unavailable",
      semanticCleanup: false,
      microphoneOwner: "none",
      auth: "unsupported",
    },
  }),
  readDictationRecordingAudio: vi.fn(),
  readDictationSettings: async () => ({
    microphoneInputDeviceId: "missing-microphone",
    keepGlobalBarVisible: false,
    playStartSound: true,
    playStopSound: true,
    globalShortcutNudgeDismissed: false,
  }),
  readGlobalDictationPermissions: async () => ({
    available: true,
    inputMonitoring: false,
    accessibility: false,
  }),
  readMicrophoneAccess: async () => "granted",
  requestMicrophoneAccess: vi.fn(),
  requestGlobalDictationAccessibility: mocks.requestAccessibility,
  requestGlobalDictationInputMonitoring: mocks.requestInputMonitoring,
  setDictationRecordingTranscript: vi.fn(),
  updateDictationSettings: vi.fn(),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VoiceSettingsPage onPathChange={() => undefined} />
    </QueryClientProvider>,
  );
};

describe("VoiceSettingsPage", () => {
  beforeEach(() => {
    mocks.requestInputMonitoring.mockReset().mockResolvedValue({
      available: true,
      inputMonitoring: true,
      accessibility: false,
    });
    mocks.requestAccessibility.mockReset().mockResolvedValue({
      available: true,
      inputMonitoring: false,
      accessibility: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
      },
    });
  });

  test("explains auth requirements, preserves a missing selection, and separates macOS permissions", async () => {
    renderPage();

    expect(
      await screen.findByText(
        "Dictation requires a ChatGPT login. API-key sessions cannot use Voice transcription.",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("Unavailable microphone")).toBeTruthy();
    expect(screen.getByText("Input Monitoring")).toBeTruthy();
    expect(screen.getByText("Accessibility")).toBeTruthy();

    const allowButtons = screen.getAllByRole("button", { name: "Allow" });
    fireEvent.click(allowButtons[0]!);
    fireEvent.click(allowButtons[1]!);
    await vi.waitFor(() => {
      expect(mocks.requestInputMonitoring).toHaveBeenCalledOnce();
      expect(mocks.requestAccessibility).toHaveBeenCalledOnce();
    });
  });
});
