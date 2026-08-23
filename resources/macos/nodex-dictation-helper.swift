import ApplicationServices
import AppKit
import CoreAudio
import CoreGraphics
import Foundation

private let protocolVersion = 1
private let maximumMessageBytes = 64 * 1024
private let maximumPasteboardFormatBytes = 8 * 1024 * 1024
private let maximumPasteboardSnapshotBytes = 32 * 1024 * 1024
private let relevantFlags: CGEventFlags = [.maskCommand, .maskControl, .maskAlternate, .maskShift, .maskSecondaryFn]

private struct Hotkey {
    let id: String
    let mode: String
    let accelerator: String
    let modifiers: CGEventFlags
    let keyCode: CGKeyCode?
    var pressed: Bool
}

private final class HelperState {
    static let shared = HelperState()
    var hotkeys: [String: Hotkey] = [:]
    var eventTap: CFMachPort?
    var runLoopSource: CFRunLoopSource?
    var generation: UInt64 = 0
    var captureRequestId: String?
    var captureTimer: Timer?
}

private let outputLock = NSLock()

@main
private enum NodexDictationHelper {
    static func main() {
        emit([
            "type": "ready",
            "protocolVersion": protocolVersion,
        ])
        DispatchQueue.global(qos: .userInitiated).async {
            readCommands()
        }
        RunLoop.main.run()
    }
}

private func readCommands() {
    while let line = readLine(strippingNewline: true) {
        guard line.utf8.count <= maximumMessageBytes,
              let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            emitError(id: nil, code: "invalid-message")
            continue
        }
        DispatchQueue.main.async {
            handle(request)
        }
    }
    DispatchQueue.main.async {
        uninstallEventTap()
        exit(EXIT_SUCCESS)
    }
}

private func handle(_ request: [String: Any]) {
    guard let id = request["id"] as? String,
          id.count <= 128,
          let type = request["type"] as? String
    else {
        emitError(id: nil, code: "invalid-request")
        return
    }

    switch type {
    case "capabilities":
        let inputMonitoring = CGPreflightListenEventAccess()
        let accessibilityOptions = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false,
        ] as CFDictionary
        let accessibility = AXIsProcessTrustedWithOptions(accessibilityOptions)
        emitResponse(id: id, value: [
            "inputMonitoring": inputMonitoring,
            "accessibility": accessibility,
        ])
    case "requestInputMonitoring":
        emitResponse(id: id, value: ["granted": CGRequestListenEventAccess()])
    case "requestAccessibility":
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
        ] as CFDictionary
        emitResponse(id: id, value: ["granted": AXIsProcessTrustedWithOptions(options)])
    case "register":
        guard let bindingId = request["bindingId"] as? String,
              let mode = request["mode"] as? String,
              mode == "hold" || mode == "toggle",
              let accelerator = request["accelerator"] as? String,
              let parsed = parseAccelerator(accelerator)
        else {
            emitError(id: id, code: "invalid-hotkey")
            return
        }
        if HelperState.shared.hotkeys.values.contains(where: {
            $0.id != bindingId && $0.modifiers == parsed.modifiers && $0.keyCode == parsed.keyCode
        }) {
            emitError(id: id, code: "hotkey-conflict")
            return
        }
        guard installEventTapIfNeeded() else {
            emitError(id: id, code: "input-monitoring-denied")
            return
        }
        HelperState.shared.hotkeys[bindingId] = Hotkey(
            id: bindingId,
            mode: mode,
            accelerator: accelerator,
            modifiers: parsed.modifiers,
            keyCode: parsed.keyCode,
            pressed: false
        )
        emitResponse(id: id, value: ["registered": true])
    case "unregister":
        guard let bindingId = request["bindingId"] as? String else {
            emitError(id: id, code: "invalid-hotkey")
            return
        }
        HelperState.shared.hotkeys.removeValue(forKey: bindingId)
        if HelperState.shared.hotkeys.isEmpty && HelperState.shared.captureRequestId == nil {
            uninstallEventTap()
        }
        emitResponse(id: id, value: ["registered": false])
    case "capture":
        guard HelperState.shared.captureRequestId == nil, installEventTapIfNeeded() else {
            emitError(id: id, code: "input-monitoring-denied")
            return
        }
        HelperState.shared.captureRequestId = id
        HelperState.shared.captureTimer?.invalidate()
        HelperState.shared.captureTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in
            guard HelperState.shared.captureRequestId == id else { return }
            HelperState.shared.captureRequestId = nil
            emitError(id: id, code: "capture-timeout")
        }
    case "safePaste":
        guard let target = request["target"] as? [String: Any],
              let pidValue = target["pid"] as? NSNumber,
              let bundleIdentifier = target["bundleIdentifier"] as? String,
              let text = request["text"] as? String,
              !text.isEmpty,
              text.utf8.count <= maximumMessageBytes / 2
        else {
            emitError(id: id, code: "invalid-target")
            return
        }
        let pid = pid_t(pidValue.int32Value)
        guard foregroundMatches(pid: pid, bundleIdentifier: bundleIdentifier) else {
            emitError(id: id, code: "target-changed")
            return
        }
        guard AXIsProcessTrusted() else {
            emitError(id: id, code: "accessibility-denied")
            return
        }
        guard let snapshot = snapshotPasteboard() else {
            emitError(id: id, code: "paste-failed")
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            restorePasteboard(snapshot)
            emitError(id: id, code: "paste-failed")
            return
        }
        let dictationChangeCount = pasteboard.changeCount
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            guard foregroundMatches(pid: pid, bundleIdentifier: bundleIdentifier),
                  AXIsProcessTrusted(),
                  postPasteShortcut(pid: pid)
            else {
                restorePasteboardIfUnchanged(
                    snapshot,
                    insertedText: text,
                    expectedChangeCount: dictationChangeCount
                )
                emitError(id: id, code: "paste-failed")
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                restorePasteboardIfUnchanged(
                    snapshot,
                    insertedText: text,
                    expectedChangeCount: dictationChangeCount
                )
                emitResponse(id: id, value: ["pasted": true])
            }
        }
    case "queryBuiltInMic":
        emitResponse(id: id, value: preferredBuiltInMicrophoneName() ?? NSNull())
    default:
        emitError(id: id, code: "unsupported-request")
    }
}

private func snapshotPasteboard() -> [NSPasteboardItem]? {
    let pasteboard = NSPasteboard.general
    var totalBytes = 0
    var snapshot: [NSPasteboardItem] = []
    for sourceItem in pasteboard.pasteboardItems ?? [] {
        let item = NSPasteboardItem()
        for type in sourceItem.types {
            guard let data = sourceItem.data(forType: type),
                  data.count <= maximumPasteboardFormatBytes
            else { return nil }
            totalBytes += data.count
            guard totalBytes <= maximumPasteboardSnapshotBytes else { return nil }
            guard item.setData(data, forType: type) else { return nil }
        }
        snapshot.append(item)
    }
    return snapshot
}

private func restorePasteboard(_ snapshot: [NSPasteboardItem]) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    _ = pasteboard.writeObjects(snapshot)
}

private func restorePasteboardIfUnchanged(
    _ snapshot: [NSPasteboardItem],
    insertedText: String,
    expectedChangeCount: Int
) {
    let pasteboard = NSPasteboard.general
    guard pasteboard.changeCount == expectedChangeCount,
          pasteboard.string(forType: .string) == insertedText
    else { return }
    restorePasteboard(snapshot)
}

private func audioDeviceId(selector: AudioObjectPropertySelector) -> AudioDeviceID? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var device = AudioDeviceID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device
    ) == noErr, device != kAudioObjectUnknown else { return nil }
    return device
}

private func audioDeviceUInt32(_ device: AudioDeviceID, selector: AudioObjectPropertySelector) -> UInt32? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else {
        return nil
    }
    return value
}

private func audioDevices() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size
    ) == noErr, size > 0 else { return [] }
    var devices = Array(
        repeating: AudioDeviceID(kAudioObjectUnknown),
        count: Int(size) / MemoryLayout<AudioDeviceID>.size
    )
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices
    ) == noErr else { return [] }
    return devices
}

private func audioDeviceHasInput(_ device: AudioDeviceID) -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreams,
        mScope: kAudioDevicePropertyScopeInput,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr && size > 0
}

private func audioDeviceName(_ device: AudioDeviceID) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioObjectPropertyName,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr,
          let value else {
        return nil
    }
    let name = value.takeUnretainedValue() as String
    return name.isEmpty ? nil : name
}

private func isBluetoothTransport(_ transport: UInt32?) -> Bool {
    transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE
}

private func hasBuiltInDisplay() -> Bool {
    NSScreen.screens.contains { screen in
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        else { return false }
        return CGDisplayIsBuiltin(CGDirectDisplayID(number.uint32Value)) != 0
    }
}

/** Avoids switching a Bluetooth output into the low-bandwidth headset profile. */
private func preferredBuiltInMicrophoneName() -> String? {
    guard hasBuiltInDisplay(),
          let defaultInput = audioDeviceId(selector: kAudioHardwarePropertyDefaultInputDevice),
          let defaultOutput = audioDeviceId(selector: kAudioHardwarePropertyDefaultOutputDevice),
          isBluetoothTransport(audioDeviceUInt32(defaultInput, selector: kAudioDevicePropertyTransportType)),
          isBluetoothTransport(audioDeviceUInt32(defaultOutput, selector: kAudioDevicePropertyTransportType)),
          audioDeviceUInt32(defaultOutput, selector: kAudioDevicePropertyDeviceIsAlive) == 1
    else { return nil }
    return audioDevices().first(where: { device in
        audioDeviceUInt32(device, selector: kAudioDevicePropertyTransportType)
            == kAudioDeviceTransportTypeBuiltIn && audioDeviceHasInput(device)
    }).flatMap(audioDeviceName)
}

private func installEventTapIfNeeded() -> Bool {
    if HelperState.shared.eventTap != nil { return true }
    guard CGPreflightListenEventAccess() else { return false }
    let mask = (1 << CGEventType.keyDown.rawValue)
        | (1 << CGEventType.keyUp.rawValue)
        | (1 << CGEventType.flagsChanged.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: CGEventMask(mask),
        callback: eventTapCallback,
        userInfo: nil
    ) else { return false }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    HelperState.shared.eventTap = tap
    HelperState.shared.runLoopSource = source
    return true
}

private func uninstallEventTap() {
    if let source = HelperState.shared.runLoopSource {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
    }
    if let tap = HelperState.shared.eventTap {
        CFMachPortInvalidate(tap)
    }
    HelperState.shared.eventTap = nil
    HelperState.shared.runLoopSource = nil
}

private let eventTapCallback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = HelperState.shared.eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    handleKeyboardEvent(type: type, event: event)
    return Unmanaged.passUnretained(event)
}

private func handleKeyboardEvent(type: CGEventType, event: CGEvent) {
    let flags = event.flags.intersection(relevantFlags)
    let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

    if let captureId = HelperState.shared.captureRequestId,
       type == .keyDown || type == .flagsChanged {
        if type == .keyDown && keyCode == 53 {
            HelperState.shared.captureRequestId = nil
            HelperState.shared.captureTimer?.invalidate()
            emitError(id: captureId, code: "capture-cancelled")
            return
        }
        if let accelerator = canonicalAccelerator(flags: flags, keyCode: type == .keyDown ? keyCode : nil) {
            HelperState.shared.captureRequestId = nil
            HelperState.shared.captureTimer?.invalidate()
            emitResponse(id: captureId, value: ["accelerator": accelerator])
            return
        }
    }

    for (id, var hotkey) in HelperState.shared.hotkeys {
        let modifiersMatch = flags == hotkey.modifiers
        let keyMatches = hotkey.keyCode == nil || hotkey.keyCode == keyCode
        let isPressed = hotkey.keyCode == nil
            ? modifiersMatch
            : modifiersMatch && keyMatches && type == .keyDown
        let isReleased = hotkey.pressed && (
            hotkey.keyCode == nil ? !modifiersMatch : keyMatches && type == .keyUp
        )
        if isPressed && !hotkey.pressed {
            hotkey.pressed = true
            HelperState.shared.hotkeys[id] = hotkey
            emitHotkeyEvent(hotkey: hotkey, type: "pressed")
        } else if isReleased {
            hotkey.pressed = false
            HelperState.shared.hotkeys[id] = hotkey
            emitHotkeyEvent(hotkey: hotkey, type: "released")
        }
    }
}

private func emitHotkeyEvent(hotkey: Hotkey, type: String) {
    HelperState.shared.generation += 1
    var event: [String: Any] = [
        "type": type,
        "bindingId": hotkey.id,
        "mode": hotkey.mode,
        "generation": HelperState.shared.generation,
    ]
    if let application = NSWorkspace.shared.frontmostApplication {
        event["target"] = [
            "pid": application.processIdentifier,
            "bundleIdentifier": application.bundleIdentifier ?? "pid.\(application.processIdentifier)",
        ]
    }
    emit(event)
}

private func parseAccelerator(_ value: String) -> (modifiers: CGEventFlags, keyCode: CGKeyCode?)? {
    let parts = value.split(separator: "+").map(String.init)
    guard !parts.isEmpty else { return nil }
    var modifiers: CGEventFlags = []
    var keyCode: CGKeyCode?
    for part in parts {
        switch part.lowercased() {
        case "cmdorctrl", "command", "cmd": modifiers.insert(.maskCommand)
        case "ctrl", "control": modifiers.insert(.maskControl)
        case "alt", "option": modifiers.insert(.maskAlternate)
        case "shift": modifiers.insert(.maskShift)
        case "fn": modifiers.insert(.maskSecondaryFn)
        default:
            guard keyCode == nil, let resolved = keyCodeForName(part) else { return nil }
            keyCode = resolved
        }
    }
    return modifiers.isEmpty && keyCode == nil ? nil : (modifiers, keyCode)
}

private func keyCodeForName(_ name: String) -> CGKeyCode? {
    let keys: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
        "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
        "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
        "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "enter": 36,
        "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43,
        "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49,
        "`": 50, "backspace": 51, "escape": 53,
    ]
    return keys[name.lowercased()]
}

private func canonicalAccelerator(flags: CGEventFlags, keyCode: CGKeyCode?) -> String? {
    var parts: [String] = []
    if flags.contains(.maskCommand) { parts.append("Command") }
    if flags.contains(.maskControl) { parts.append("Ctrl") }
    if flags.contains(.maskAlternate) { parts.append("Alt") }
    if flags.contains(.maskShift) { parts.append("Shift") }
    if flags.contains(.maskSecondaryFn) { parts.append("Fn") }
    if let keyCode, let name = keyNameForCode(keyCode) { parts.append(name.uppercased()) }
    return parts.isEmpty ? nil : parts.joined(separator: "+")
}

private func keyNameForCode(_ code: CGKeyCode) -> String? {
    for candidate in "abcdefghijklmnopqrstuvwxyz0123456789" {
        if keyCodeForName(String(candidate)) == code { return String(candidate) }
    }
    return nil
}

private func foregroundMatches(pid: pid_t, bundleIdentifier: String) -> Bool {
    guard let app = NSWorkspace.shared.frontmostApplication else { return false }
    let actualBundle = app.bundleIdentifier ?? "pid.\(app.processIdentifier)"
    return app.processIdentifier == pid && actualBundle == bundleIdentifier
}

private func postPasteShortcut(pid: pid_t) -> Bool {
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false)
    else { return false }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.postToPid(pid)
    up.postToPid(pid)
    return true
}

private func emitResponse(id: String, value: Any) {
    emit(["type": "response", "id": id, "ok": true, "value": value])
}

private func emitError(id: String?, code: String) {
    var payload: [String: Any] = ["type": "response", "ok": false, "error": code]
    if let id { payload["id"] = id }
    emit(payload)
}

private func emit(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          data.count <= maximumMessageBytes
    else { return }
    outputLock.lock()
    defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}
