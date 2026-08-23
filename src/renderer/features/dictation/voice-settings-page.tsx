import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NodexButton } from "@/components/ui/button";
import {
  NodexSettingsPageSurface,
  NodexSettingsRow,
  NodexSettingsSection,
} from "@/components/ui/settings";
import { ConfigValueDropdown } from "@/components/workbench/config-value-dropdown";
import { TogglePill } from "@/components/workbench/workbench-settings-route-shell";
import { toast } from "@/components/ui/toast";
import {
  deleteDictationRecording,
  downloadDictationRecording,
  listDictationRecordings,
  openGlobalDictationAccessibilitySettings,
  openGlobalDictationInputMonitoringSettings,
  openMicrophoneSettings,
  readDictationRecordingAudio,
  readDictationCapabilityState,
  readDictationSettings,
  readGlobalDictationPermissions,
  readMicrophoneAccess,
  requestMicrophoneAccess,
  requestGlobalDictationAccessibility,
  requestGlobalDictationInputMonitoring,
  setDictationRecordingTranscript,
  updateDictationSettings,
} from "@/lib/api";
import type { DictationSettings, MicrophoneAccessStatus } from "../../../shared/dictation";
import { transcribeDictationBlob } from "./dictation-buffered-client";

const SETTINGS_QUERY_KEY = ["settings", "dictation"] as const;
const HISTORY_QUERY_KEY = ["dictation", "history"] as const;
const GLOBAL_PERMISSIONS_QUERY_KEY = ["dictation", "global-permissions"] as const;
const CAPABILITY_QUERY_KEY = ["dictation", "capabilities"] as const;

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const deviceOptions = (
  devices: readonly MediaDeviceInfo[],
  selectedId: string | null,
): Array<{ value: string; label: string }> => {
  const inputs = devices.filter(
    (device) => device.kind === "audioinput" && device.deviceId !== "default",
  );
  const options = [
    { value: "", label: "System default" },
    ...inputs.map((device, index) => ({
      value: device.deviceId,
      label: device.label.trim() || `Microphone ${index + 1}`,
    })),
  ];
  if (selectedId && !inputs.some((device) => device.deviceId === selectedId)) {
    options.push({ value: selectedId, label: "Unavailable microphone" });
  }
  return options;
};

export function VoiceSettingsPage({
  onPathChange,
}: {
  readonly onPathChange: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: readDictationSettings,
  });
  const historyQuery = useQuery({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: listDictationRecordings,
  });
  const globalPermissionsQuery = useQuery({
    queryKey: GLOBAL_PERMISSIONS_QUERY_KEY,
    queryFn: readGlobalDictationPermissions,
  });
  const capabilityQuery = useQuery({
    queryKey: CAPABILITY_QUERY_KEY,
    queryFn: readDictationCapabilityState,
  });
  const [permissionStatus, setPermissionStatus] = useState<MicrophoneAccessStatus>("unknown");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void readMicrophoneAccess().then((status) => {
      if (!cancelled) setPermissionStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (permissionStatus !== "granted") {
      setDevices([]);
      return;
    }
    let cancelled = false;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((nextDevices) => {
        if (!cancelled) setDevices(nextDevices);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [permissionStatus]);

  const updateSettings = useMutation({
    mutationFn: updateDictationSettings,
    onSuccess: (settings) => queryClient.setQueryData(SETTINGS_QUERY_KEY, settings),
    onError: () => toast.danger("Could not save Voice settings"),
  });
  const settings: DictationSettings | undefined = settingsQuery.data;

  const requestPermission = async (): Promise<void> => {
    const result = await requestMicrophoneAccess();
    setPermissionStatus(
      result.kind === "granted"
        ? "granted"
        : result.kind === "blocked"
          ? result.status
          : result.kind === "unavailable"
            ? result.status
            : "unknown",
    );
    if (result.kind === "blocked") {
      toast.warning("Microphone access is blocked", {
        description: "Open System Settings, allow Nodex, then relaunch the app.",
        action: { label: "Open settings", onClick: () => void openMicrophoneSettings() },
      });
    }
  };

  const requestGlobalPermission = async (
    kind: "input-monitoring" | "accessibility",
  ): Promise<void> => {
    const next =
      kind === "input-monitoring"
        ? await requestGlobalDictationInputMonitoring()
        : await requestGlobalDictationAccessibility();
    queryClient.setQueryData(GLOBAL_PERMISSIONS_QUERY_KEY, next);
    const granted = kind === "input-monitoring" ? next.inputMonitoring : next.accessibility;
    if (granted) return;
    toast.warning(
      kind === "input-monitoring"
        ? "Input Monitoring still needs approval"
        : "Accessibility still needs approval",
      {
        description: "Allow Nodex in System Settings, then return to Voice settings.",
        action: {
          label: "Open settings",
          onClick: () =>
            void (kind === "input-monitoring"
              ? openGlobalDictationInputMonitoringSettings()
              : openGlobalDictationAccessibilitySettings()),
        },
      },
    );
  };

  const retryRecording = async (id: string): Promise<void> => {
    try {
      const audio = await readDictationRecordingAudio(id);
      const transcript = (
        await transcribeDictationBlob(
          new Blob([Uint8Array.from(audio.bytes).buffer], { type: audio.recording.mimeType }),
        )
      ).trim();
      await setDictationRecordingTranscript({ id, transcript });
      await queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
      toast.success("Recording transcribed");
    } catch {
      toast.danger("Could not transcribe this recording");
    }
  };

  return (
    <NodexSettingsPageSurface
      title="Voice"
      subtitle="Microphone, dictation behavior, and recoverable recordings."
    >
      {capabilityQuery.data && capabilityQuery.data.capabilities.auth !== "chatgpt" ? (
        <div className="mx-4 rounded-xl border border-token-border bg-token-list-hover-background px-4 py-3 text-sm text-token-text-secondary">
          Dictation requires a ChatGPT login. API-key sessions cannot use Voice transcription.
        </div>
      ) : null}
      <NodexSettingsSection title="Microphone">
        <NodexSettingsRow
          label="Input device"
          description={
            permissionStatus === "granted"
              ? "Choose a microphone, or follow the current system default."
              : "Microphone names become available after you grant access."
          }
        >
          {permissionStatus === "granted" && settings ? (
            <ConfigValueDropdown
              value={settings.microphoneInputDeviceId ?? ""}
              options={deviceOptions(devices, settings.microphoneInputDeviceId)}
              disabled={updateSettings.isPending}
              onSelect={(value) => {
                updateSettings.mutate({ microphoneInputDeviceId: value || null });
              }}
            />
          ) : permissionStatus === "denied" || permissionStatus === "restricted" ? (
            <NodexButton
              size="xs"
              variant="secondary"
              onClick={() => void openMicrophoneSettings()}
            >
              Open settings
            </NodexButton>
          ) : (
            <NodexButton size="xs" variant="secondary" onClick={() => void requestPermission()}>
              Allow access
            </NodexButton>
          )}
        </NodexSettingsRow>
      </NodexSettingsSection>

      <NodexSettingsSection title="Dictation">
        <NodexSettingsRow
          label="Composer shortcut"
          description="Hold the configured app shortcut to record, then release to insert."
        >
          <NodexButton
            size="xs"
            variant="secondary"
            onClick={() => onPathChange("/settings/keyboard-shortcuts#composerDictationHold")}
          >
            Configure
          </NodexButton>
        </NodexSettingsRow>
        {globalPermissionsQuery.data?.available ? (
          <>
            <NodexSettingsRow
              label="Input Monitoring"
              description="Lets the macOS helper hear global hold and toggle shortcuts."
            >
              {globalPermissionsQuery.data.inputMonitoring ? (
                <span className="text-xs text-token-text-secondary">Allowed</span>
              ) : (
                <NodexButton
                  size="xs"
                  variant="secondary"
                  onClick={() => void requestGlobalPermission("input-monitoring")}
                >
                  Allow
                </NodexButton>
              )}
            </NodexSettingsRow>
            <NodexSettingsRow
              label="Accessibility"
              description="Lets Nodex paste completed global dictation into the original app."
            >
              {globalPermissionsQuery.data.accessibility ? (
                <span className="text-xs text-token-text-secondary">Allowed</span>
              ) : (
                <NodexButton
                  size="xs"
                  variant="secondary"
                  onClick={() => void requestGlobalPermission("accessibility")}
                >
                  Allow
                </NodexButton>
              )}
            </NodexSettingsRow>
          </>
        ) : null}
        <NodexSettingsRow
          label="Global shortcuts"
          description="Global hold and toggle are available when Input Monitoring is allowed on macOS."
        >
          <NodexButton
            size="xs"
            variant="secondary"
            onClick={() => onPathChange("/settings/keyboard-shortcuts#globalDictationHold")}
          >
            Configure
          </NodexButton>
        </NodexSettingsRow>
        <NodexSettingsRow
          label="Keep global bar visible"
          description="Leave the compact dictation bar visible between global sessions."
        >
          <TogglePill
            ariaLabel="Keep global dictation bar visible"
            value={settings?.keepGlobalBarVisible ?? false}
            disabled={!settings || updateSettings.isPending}
            onChange={(value) => updateSettings.mutate({ keepGlobalBarVisible: value })}
          />
        </NodexSettingsRow>
        <NodexSettingsRow
          label="Start sound"
          description="Play a short confirmation after recording begins."
        >
          <TogglePill
            ariaLabel="Play dictation start sound"
            value={settings?.playStartSound ?? true}
            disabled={!settings || updateSettings.isPending}
            onChange={(value) => updateSettings.mutate({ playStartSound: value })}
          />
        </NodexSettingsRow>
        <NodexSettingsRow
          label="Stop sound"
          description="Play a short confirmation after recording stops."
        >
          <TogglePill
            ariaLabel="Play dictation stop sound"
            value={settings?.playStopSound ?? true}
            disabled={!settings || updateSettings.isPending}
            onChange={(value) => updateSettings.mutate({ playStopSound: value })}
          />
        </NodexSettingsRow>
      </NodexSettingsSection>

      <NodexSettingsSection title="Recent recordings">
        {historyQuery.isLoading ? (
          <div className="px-4 py-3 text-sm text-token-text-secondary">Loading recordings…</div>
        ) : historyQuery.data?.length ? (
          historyQuery.data.map((recording) => (
            <NodexSettingsRow
              key={recording.id}
              label={new Date(recording.createdAtMs).toLocaleString()}
              description={`${recording.status} · ${formatDuration(recording.durationMs)} · ${recording.surface}`}
            >
              {recording.transcript ? (
                <NodexButton
                  size="xs"
                  variant="ghost"
                  onClick={() => void navigator.clipboard.writeText(recording.transcript ?? "")}
                >
                  Copy
                </NodexButton>
              ) : (
                <NodexButton
                  size="xs"
                  variant="ghost"
                  onClick={() => void retryRecording(recording.id)}
                >
                  Retry
                </NodexButton>
              )}
              <NodexButton
                size="xs"
                variant="ghost"
                onClick={() => void downloadDictationRecording(recording.id)}
              >
                Download
              </NodexButton>
              <NodexButton
                size="xs"
                variant="ghost"
                disabled={recording.status === "recording"}
                onClick={async () => {
                  await deleteDictationRecording(recording.id);
                  await queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
                }}
              >
                Delete
              </NodexButton>
            </NodexSettingsRow>
          ))
        ) : (
          <div className="px-4 py-3 text-sm text-token-text-secondary">No recordings yet.</div>
        )}
      </NodexSettingsSection>
    </NodexSettingsPageSurface>
  );
}
