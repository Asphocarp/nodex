import ApplicationServices
import AppKit
import CoreGraphics
import Foundation

private let maximumAccessibilityCharacters = 24_000
private let maximumAccessibilityDepth = 8
private let maximumAccessibilityNodes = 400

private struct WindowBounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct FrontmostWindow: Codable {
    let name: String
    let bundleIdentifier: String
    let processIdentifier: Int32
    let windowId: UInt32
    let windowTitle: String?
    let bounds: WindowBounds
    let axTree: String
}

private struct AccessibilityWindowSnapshot {
    let element: AXUIElement
    let title: String?
    let bounds: WindowBounds?
}

private enum HelperFailure: LocalizedError {
    case invalidArguments

    var errorDescription: String? {
        switch self {
        case .invalidArguments:
            return "usage: nodex-appshot-helper frontmost-window"
        }
    }
}

@main
private enum NodexAppshotHelper {
    static func main() {
        do {
            guard CommandLine.arguments.count == 2,
                  CommandLine.arguments[1] == "frontmost-window"
            else {
                throw HelperFailure.invalidArguments
            }
            emit(try readFrontmostWindow())
        } catch {
            FileHandle.standardError.write(
                Data("\(error.localizedDescription)\n".utf8)
            )
            exit(EXIT_FAILURE)
        }
    }
}

private func readFrontmostWindow() throws -> FrontmostWindow? {
    guard let application = NSWorkspace.shared.frontmostApplication else {
        return nil
    }
    let processIdentifier = application.processIdentifier
    guard processIdentifier > 0 else {
        return nil
    }

    let windowInfo = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] ?? []
    let candidateWindows = windowInfo.filter {
        readInt32($0, key: kCGWindowOwnerPID) == processIdentifier
            && readInt($0, key: kCGWindowLayer) == 0
            && readDouble($0, key: kCGWindowAlpha) > 0
            && readBounds($0) != nil
    }
    guard !candidateWindows.isEmpty else {
        return nil
    }

    let accessibilityWindow = readAccessibilityWindow(
        processIdentifier: processIdentifier
    )
    let window = selectFrontmostWindow(
        candidateWindows,
        accessibilityWindow: accessibilityWindow
    )
    guard
    let windowId = readUInt32(window, key: kCGWindowNumber),
    let bounds = readBounds(window)
    else {
        return nil
    }

    let name = application.localizedName?.trimmingCharacters(in: .whitespacesAndNewlines)
        ?? readString(window, key: kCGWindowOwnerName)
        ?? "App"
    let rawBundleIdentifier = application.bundleIdentifier?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let bundleIdentifier = rawBundleIdentifier.isEmpty
        ? "pid.\(processIdentifier)"
        : rawBundleIdentifier
    let windowTitle = normalizedOptionalString(
        accessibilityWindow?.title
            ?? readString(window, key: kCGWindowName)
    )

    return FrontmostWindow(
        name: name.isEmpty ? "App" : name,
        bundleIdentifier: bundleIdentifier,
        processIdentifier: processIdentifier,
        windowId: windowId,
        windowTitle: windowTitle,
        bounds: bounds,
        axTree: buildAccessibilityTree(
            root: accessibilityWindow?.element,
            appName: name,
            windowTitle: windowTitle
        )
    )
}

private func readAccessibilityWindow(
    processIdentifier: Int32
) -> AccessibilityWindowSnapshot? {
    guard AXIsProcessTrusted() else {
        return nil
    }
    let application = AXUIElementCreateApplication(processIdentifier)
    guard let element = copyAccessibilityElement(
        application,
        attribute: kAXFocusedWindowAttribute as CFString
    ) ?? copyAccessibilityElement(
        application,
        attribute: kAXMainWindowAttribute as CFString
    ) else {
        return nil
    }
    let title = copyAccessibilityString(
        element,
        attribute: kAXTitleAttribute as CFString
    )
    let position = copyAccessibilityPoint(
        element,
        attribute: kAXPositionAttribute as CFString
    )
    let size = copyAccessibilitySize(
        element,
        attribute: kAXSizeAttribute as CFString
    )
    let bounds = position.flatMap { position in
        size.map { size in
            WindowBounds(
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height
            )
        }
    }
    return AccessibilityWindowSnapshot(
        element: element,
        title: title,
        bounds: bounds
    )
}

private func selectFrontmostWindow(
    _ windows: [[String: Any]],
    accessibilityWindow: AccessibilityWindowSnapshot?
) -> [String: Any] {
    if let title = accessibilityWindow?.title,
       let exactTitleMatch = windows.first(where: {
           normalizedOptionalString(readString($0, key: kCGWindowName)) == title
       })
    {
        return exactTitleMatch
    }
    if let accessibilityBounds = accessibilityWindow?.bounds,
       let closestBoundsMatch = windows.min(by: {
           windowBoundsDistance($0, accessibilityBounds)
               < windowBoundsDistance($1, accessibilityBounds)
       })
    {
        return closestBoundsMatch
    }
    return windows[0]
}

private func windowBoundsDistance(
    _ window: [String: Any],
    _ target: WindowBounds
) -> Double {
    guard let bounds = readBounds(window) else {
        return .greatestFiniteMagnitude
    }
    return abs(bounds.x - target.x)
        + abs(bounds.y - target.y)
        + abs(bounds.width - target.width)
        + abs(bounds.height - target.height)
}

private func buildAccessibilityTree(
    root: AXUIElement?,
    appName: String,
    windowTitle: String?
) -> String {
    let safeAppName = normalizedInlineText(appName, limit: 300)
    let safeWindowTitle = normalizedInlineText(windowTitle ?? "", limit: 500)
    var lines = [
        "Window: \"\(safeWindowTitle)\", App: \(safeAppName)",
    ]
    guard let root else {
        return lines.joined(separator: "\n")
    }

    var state = AccessibilityTraversalState()
    appendAccessibilityElement(root, depth: 0, lines: &lines, state: &state)
    let joined = lines.joined(separator: "\n")
    return String(joined.prefix(maximumAccessibilityCharacters))
}

private struct AccessibilityTraversalState {
    var nodeCount = 0
}

private func appendAccessibilityElement(
    _ element: AXUIElement,
    depth: Int,
    lines: inout [String],
    state: inout AccessibilityTraversalState
) {
    guard depth <= maximumAccessibilityDepth,
          state.nodeCount < maximumAccessibilityNodes
    else {
        return
    }
    state.nodeCount += 1

    let role = copyAccessibilityString(
        element,
        attribute: kAXRoleAttribute as CFString
    ) ?? "AXElement"
    let subrole = copyAccessibilityString(
        element,
        attribute: kAXSubroleAttribute as CFString
    )
    let title = copyAccessibilityString(
        element,
        attribute: kAXTitleAttribute as CFString
    )
    let description = copyAccessibilityString(
        element,
        attribute: kAXDescriptionAttribute as CFString
    )
    let value = subrole == (kAXSecureTextFieldSubrole as String)
        ? nil
        : copyAccessibilityScalarDescription(
            element,
            attribute: kAXValueAttribute as CFString
        )

    let attributes = [
        subrole.map { "subrole=\(normalizedInlineText($0, limit: 160))" },
        title.map { "title=\(normalizedInlineText($0, limit: 500))" },
        description.map {
            "description=\(normalizedInlineText($0, limit: 500))"
        },
        value.map { "value=\(normalizedInlineText($0, limit: 800))" },
    ].compactMap { $0 }
    let suffix = attributes.isEmpty ? "" : " \(attributes.joined(separator: " "))"
    lines.append(
        "\(String(repeating: "  ", count: depth))\(role)\(suffix)"
    )

    guard let children = copyAccessibilityElements(
        element,
        attribute: kAXChildrenAttribute as CFString
    ) else {
        return
    }
    for child in children {
        guard lines.joined(separator: "\n").count < maximumAccessibilityCharacters else {
            return
        }
        appendAccessibilityElement(
            child,
            depth: depth + 1,
            lines: &lines,
            state: &state
        )
    }
}

private func copyAccessibilityValue(
    _ element: AXUIElement,
    attribute: CFString
) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
        return nil
    }
    return value
}

private func copyAccessibilityElement(
    _ element: AXUIElement,
    attribute: CFString
) -> AXUIElement? {
    guard let value = copyAccessibilityValue(element, attribute: attribute),
          CFGetTypeID(value) == AXUIElementGetTypeID()
    else {
        return nil
    }
    return unsafeBitCast(value, to: AXUIElement.self)
}

private func copyAccessibilityElements(
    _ element: AXUIElement,
    attribute: CFString
) -> [AXUIElement]? {
    guard let value = copyAccessibilityValue(element, attribute: attribute),
          CFGetTypeID(value) == CFArrayGetTypeID()
    else {
        return nil
    }
    return value as? [AXUIElement]
}

private func copyAccessibilityString(
    _ element: AXUIElement,
    attribute: CFString
) -> String? {
    guard let value = copyAccessibilityValue(element, attribute: attribute) else {
        return nil
    }
    if CFGetTypeID(value) == CFStringGetTypeID() {
        return normalizedOptionalString(value as? String)
    }
    return nil
}

private func copyAccessibilityScalarDescription(
    _ element: AXUIElement,
    attribute: CFString
) -> String? {
    guard let value = copyAccessibilityValue(element, attribute: attribute) else {
        return nil
    }
    if CFGetTypeID(value) == CFStringGetTypeID() {
        return normalizedOptionalString(value as? String)
    }
    if CFGetTypeID(value) == CFBooleanGetTypeID()
        || CFGetTypeID(value) == CFNumberGetTypeID()
    {
        return normalizedOptionalString(String(describing: value))
    }
    return nil
}

private func copyAccessibilityPoint(
    _ element: AXUIElement,
    attribute: CFString
) -> CGPoint? {
    guard let value = copyAccessibilityValue(element, attribute: attribute),
          CFGetTypeID(value) == AXValueGetTypeID()
    else {
        return nil
    }
    let axValue = unsafeBitCast(value, to: AXValue.self)
    guard AXValueGetType(axValue) == .cgPoint else {
        return nil
    }
    var point = CGPoint.zero
    guard AXValueGetValue(axValue, .cgPoint, &point) else {
        return nil
    }
    return point
}

private func copyAccessibilitySize(
    _ element: AXUIElement,
    attribute: CFString
) -> CGSize? {
    guard let value = copyAccessibilityValue(element, attribute: attribute),
          CFGetTypeID(value) == AXValueGetTypeID()
    else {
        return nil
    }
    let axValue = unsafeBitCast(value, to: AXValue.self)
    guard AXValueGetType(axValue) == .cgSize else {
        return nil
    }
    var size = CGSize.zero
    guard AXValueGetValue(axValue, .cgSize, &size) else {
        return nil
    }
    return size
}

private func readBounds(_ window: [String: Any]) -> WindowBounds? {
    guard let rawBounds = window[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(
              dictionaryRepresentation: rawBounds as CFDictionary
          ),
          rect.width >= 40,
          rect.height >= 40
    else {
        return nil
    }
    return WindowBounds(
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.width,
        height: rect.height
    )
}

private func readString(
    _ value: [String: Any],
    key: CFString
) -> String? {
    value[key as String] as? String
}

private func readInt(
    _ value: [String: Any],
    key: CFString
) -> Int {
    (value[key as String] as? NSNumber)?.intValue ?? Int.min
}

private func readInt32(
    _ value: [String: Any],
    key: CFString
) -> Int32 {
    (value[key as String] as? NSNumber)?.int32Value ?? Int32.min
}

private func readUInt32(
    _ value: [String: Any],
    key: CFString
) -> UInt32? {
    (value[key as String] as? NSNumber)?.uint32Value
}

private func readDouble(
    _ value: [String: Any],
    key: CFString
) -> Double {
    (value[key as String] as? NSNumber)?.doubleValue ?? 0
}

private func normalizedOptionalString(_ value: String?) -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return normalized.isEmpty ? nil : normalized
}

private func normalizedInlineText(_ value: String, limit: Int) -> String {
    let normalized = value
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
        .split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
    return String(normalized.prefix(limit))
}

private func emit<T: Encodable>(_ value: T?) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try! encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}
