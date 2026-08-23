# Dictation Behavior

## Intent

Dictation turns a bounded microphone recording into text. It is available in the Electron app for ChatGPT-authenticated sessions and is separate from realtime voice conversation. This document owns the user-visible Composer, global dictation, Voice settings, recording recovery, and error behavior.

## Capability and ownership model

- Main publishes one capability snapshot for Composer, macOS global dictation, streaming, history, semantic cleanup, authentication, and the current microphone owner.
- ChatGPT authentication enables transcription. API-key and unauthenticated sessions keep dictation disabled and explain that ChatGPT login is required.
- `microphoneOwner` is the mutual-exclusion authority. Dictation cannot start while realtime voice owns the microphone; realtime voice cannot take ownership from an active dictation session.
- A mounted capture surface owns its `DictationSessionController`, `MediaStream`, recorder, waveform graph, and streaming port. Unmount, capability loss, cancel, or app teardown disposes that controller and stops every track.
- Main owns microphone permission, settings, recording history, streaming credentials/socket transport, global hotkeys, the auxiliary window, and cross-application paste.
- Composer and the global bar use the same capture controller contract. They differ only in completion: Composer inserts or submits text; global dictation pastes into the application that was active when the shortcut began.

## Composer behavior

- The active Thread Composer shows a `Dictate` button when capture is supported. Clicking begins recording. Holding the configured Composer shortcut begins on keydown and stops on keyup.
- Recording shows elapsed time and a live waveform. The active footer offers `Stop dictation`, which transcribes and inserts, and `Transcribe and send`, which inserts through the ordinary Composer path and submits through the ordinary submit policy.
- A stop action may upgrade from insert to send while finalization is in progress, but text is applied exactly once. Cancel during recording or transcription applies no text.
- Dictation text is trimmed before insertion. The editor owns cursor/selection placement; dictation does not create a separate transcript row or bypass ordinary prompt submission.
- The visible transcript behavior after insertion or send remains governed by [Codex Thread Transcript Behavior](codex-thread-transcript-behavior.md).

## Session lifecycle

The controller has explicit idle, permission/acquisition, recording, stopping, transcribing, retryable-error, and disposed states. Only one session and one acquisition generation may be current.

- Permission completes before `getUserMedia` begins. A release, cancel, replacement start, unmount, or capability change invalidates the generation; a late stream is stopped immediately and cannot activate recording.
- The device policy tries the selected microphone, then the current built-in microphone hint when macOS is routing input/output through Bluetooth, then the system default, then the first real input. Permission or security failures never trigger device fallback. A missing, busy, or unsupported route may continue to the next safe candidate.
- `MediaRecorder` records continuously and emits recovery chunks every five seconds. An `AudioWorklet` separately produces mono PCM16 frames for streaming and never owns the durable recording.
- Recordings shorter than 250 ms, or with no audio chunk, are cancelled locally and are not uploaded. A session stops once at 595 seconds.
- Recorder final data is consumed before finalization. Recorder errors, ended tracks, repeated stop/cancel, and late transcription results cannot finalize or apply a session twice.

## Transcription and recovery

- ChatGPT sessions attempt streaming first while always retaining the complete `MediaRecorder` recording.
- Streaming uses Main-provided connection information and a dedicated MessagePort. Socket creation, start/finish timeout, backpressure, malformed events, an empty final, or a non-abort close disables only that attempt.
- A successful non-empty streaming final is used directly and does not send a buffered request.
- Any retryable streaming failure automatically transcribes the same complete recording through the buffered endpoint. Abort never falls back.
- An explicitly unsupported streaming endpoint is cached for the current authority/process and later sessions go directly to buffered transcription. Account authority or app-server connection replacement resets that cache.
- A retryable buffered failure preserves the same recording and offers `Retry`; retry does not ask the user to speak again.

## Recording history and Voice settings

Settings → Voice owns:

- microphone permission and input-device selection, including `System default` and an explicit unavailable selection;
- separate macOS Input Monitoring and Accessibility status/actions;
- links to configure Composer hold, global hold, and global toggle shortcuts;
- `Keep global bar visible`, start-sound, and stop-sound preferences;
- the twenty most recent recoverable recordings.

Each session creates a Profile-scoped history entry and appends ordered chunks while recording. Completed entries retain duration, surface, audio MIME type, status, and an optional transcript. A process interruption changes an unfinished `recording` entry to `interrupted` on the next scan. Users can copy an available transcript, retry transcription from retained audio, download reconstructed audio through a native Save dialog, or delete a non-active entry. Retention never deletes an active recording.

History is a recovery feature, not a second conversation transcript. Deleting a recording does not remove text already inserted or sent. Dictation settings are Main-owned and shared by every window.

## macOS global dictation

- Global hold and toggle are macOS-only configurable shortcuts and may use bare modifier or Fn chords. Hold starts on press and stops on release. Toggle starts on the first non-repeat press and stops on the next.
- Input Monitoring is required to observe global key transitions. Accessibility is independently required only for cross-application paste; denying it does not disable Composer dictation.
- Main captures the foreground process and bundle identity at shortcut activation. If a focused Nodex Composer accepts the session within 150 ms, it records and inserts in-app without opening a second recorder. Otherwise Main shows the compact global bar and routes the shared controller there.
- The global bar is a 720 × 84 frameless, transparent, non-activating macOS window positioned bottom-center on the active display. It does not take keyboard focus. Its content is pointer-through except while the pointer is over the bar.
- Start and stop sounds are best-effort and follow Voice settings. Playback failure never affects capture.
- On completion, Main pastes `trim(transcript) + " "` into the exact application captured at activation. It waits at least 150 ms before paste.
- Main checks Accessibility before changing the clipboard, snapshots every bounded clipboard format, performs the targeted paste, and waits about 700 ms. It restores the snapshot only if the clipboard still contains Nodex's inserted text. A copy made by the user during that interval always wins.
- Accessibility denial or paste failure leaves the transcript/audio in history and keeps a retryable error. Accessibility errors offer `Open Settings`; the user may retry or dismiss without losing the recording.
- When `Keep global bar visible` is off, successful completion hides the bar. When on, the idle/error bar may remain visible without taking focus.

## Permissions and errors

- macOS microphone access is a typed, awaited operation. `granted` proceeds; `denied` and `restricted` do not repeatedly prompt and offer System Settings; unavailable platforms report unavailability.
- Electron grants only audio capture to an owned, top-level, trusted app renderer. Camera, guest, subframe, cross-origin, and unowned requests are denied.
- User-facing failures distinguish microphone blocked, missing, busy, unsupported constraints/capture, interrupted capture, network, rate limit, authentication, service, history, Accessibility, and paste.
- Errors retain only stable operation/kind/status/native-name diagnostics. Audio, transcript, device labels, dictionary values, clipboard content, and raw service bodies are never logged or sent to telemetry.

## Platform and release boundary

Composer dictation requires an Electron media environment. Global dictation is a signed macOS capability; other platforms report it unavailable rather than emulating incomplete hold behavior. A release is valid only when the final signed app carries the microphone usage description and audio-input entitlement, nested code is signed with its narrower entitlements, and the packaged native helper passes the runtime manifest and architecture checks.
