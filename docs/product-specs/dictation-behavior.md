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
- Recording replaces the ordinary Composer footer with a stable `cancel | waveform | stop | send` row. The scrolling waveform advances at a fixed 30 px/s. `Stop dictation` transcribes and inserts; `Transcribe and send` inserts through the ordinary Composer path and submits through the ordinary submit policy.
- After either stop action, the same footer remains mounted and shows centered `Transcribing`; the selected stop/send action shows progress and both completion actions are disabled until transcription settles. It never flashes back to the ordinary Composer footer between capture and transcript delivery.
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
- Global dictation and recording recovery run a best-effort semantic cleanup pass using surrounding text and the Voice dictionary. Cleanup fixes likely recognition mistakes while preserving intent and fails open to the original transcript. The current Composer path intentionally preserves the raw transcription result.
- Composer start and transcription failures use the app-owned top notification surface. A retained-audio transcription failure offers `View recording`, `Retry`, and close; it does not render a Composer-local toast.

## Recording history and Voice settings

Settings → Voice owns:

- microphone permission and input-device selection, including `System default` and an explicit unavailable selection;
- separate macOS Input Monitoring and Accessibility status/actions;
- inline global hold and global toggle shortcut recorders that share the same chord capture component as Settings → Keyboard shortcuts;
- `Keep dictation bar visible` and `Play dictation sounds` preferences;
- a persistent Dictation dictionary of up to 100 canonical names, phrases, file paths, and code symbols;
- the twenty most recent recoverable recordings.

Shortcut capture waits for a non-modifier key before committing a chord, so pressing Control and then Y records `Ctrl+Y`, not `Ctrl`. Modifier-only global bindings commit only after the same physical modifier is released and preserve supported left/right identities. Fn capture uses a Fn-only native bridge because it may not produce a DOM keyboard event; values other than `Fn` from that boundary are ignored.

An ordinary global shortcut must contain exactly one non-modifier key and at least one of Cmd/Ctrl or Alt. Shift does not qualify by itself. Invalid unmodified chords such as `Y` and `Shift+Y` leave the previous setting unchanged and show `Shortcut must include Cmd/Ctrl or Alt.` Supported macOS bare bindings are Fn, left Control, left/right Option, left/right Command, and their supported double-modifier forms; right Control and a single left/right Shift are rejected. The same validation runs before persistence in Main even when a renderer bypasses the visible settings control.

Each session creates a Profile-scoped history entry and appends ordered chunks while recording. Completed entries retain duration, surface, audio MIME type, status, and an optional transcript. A process interruption changes an unfinished `recording` entry to `interrupted` on the next scan. Recent rows show transcript-or-status plus timestamp, with an inline copy or retry action and an overflow menu for download/delete. Users can retry transcription from retained audio, download reconstructed audio through a native Save dialog, or delete a non-active entry. Retention never deletes an active recording.

History is a recovery feature, not a second conversation transcript. Deleting a recording does not remove text already inserted or sent. Dictation settings are Main-owned and shared by every window.

## macOS global dictation

- Global hold and toggle are macOS-only configurable shortcuts and may use supported bare modifiers, including Fn. Hold starts on press and stops on release. Toggle starts on the first non-repeat press and stops on the next.
- Input Monitoring is required to observe global key transitions. Accessibility is independently required only for cross-application paste; denying it does not disable Composer dictation.
- Main captures the foreground process and bundle identity at shortcut activation. If a focused Nodex Composer accepts the session within 150 ms, it records and inserts in-app without opening a second recorder. Otherwise Main shows the compact global bar and routes the shared controller there.
- The global bar is a 720 × 84 frameless, transparent, non-activating macOS window positioned bottom-center on the active display. It stays available across Spaces and fullscreen apps without changing Nodex's foreground application identity, Dock presence, or application menu. It does not take keyboard focus. Its content is pointer-through except while the pointer is over the bar.
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
