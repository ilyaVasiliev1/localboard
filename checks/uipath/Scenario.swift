import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct Failure: Error {
  let step: String
  let message: String
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success
    ? value : nil
}

func text(_ element: AXUIElement) -> String {
  ["AXTitle", "AXDescription", "AXValue", "AXPlaceholderValue"]
    .compactMap { attribute(element, $0) as? String }
    .joined(separator: " ")
}

func role(_ element: AXUIElement) -> String {
  (attribute(element, "AXRole") as? String) ?? ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
  (attribute(element, "AXChildren") as? [AXUIElement]) ?? []
}

func windows(_ element: AXUIElement) -> [AXUIElement] {
  (attribute(element, "AXWindows") as? [AXUIElement]) ?? []
}

func point(_ element: AXUIElement, _ name: String) -> CGPoint? {
  guard let raw = attribute(element, name), CFGetTypeID(raw) == AXValueGetTypeID() else {
    return nil
  }
  var value = CGPoint.zero
  return AXValueGetValue(raw as! AXValue, .cgPoint, &value) ? value : nil
}

func size(_ element: AXUIElement, _ name: String) -> CGSize? {
  guard let raw = attribute(element, name), CFGetTypeID(raw) == AXValueGetTypeID() else {
    return nil
  }
  var value = CGSize.zero
  return AXValueGetValue(raw as! AXValue, .cgSize, &value) ? value : nil
}

func find(
  _ root: AXUIElement, depth: Int = 60, where matches: (AXUIElement) -> Bool
) -> AXUIElement? {
  if matches(root) { return root }
  guard depth > 0 else { return nil }
  for child in children(root) {
    if let result = find(child, depth: depth - 1, where: matches) { return result }
  }
  return nil
}

func treeLines(_ root: AXUIElement, depth: Int = 0, limit: Int = 120) -> [String] {
  guard depth < 12, limit > 0 else { return [] }
  var lines = [String(repeating: "  ", count: depth) + "\(role(root)) \(text(root))"]
  for child in children(root) where lines.count < limit {
    lines.append(contentsOf: treeLines(child, depth: depth + 1, limit: limit - lines.count))
  }
  return lines
}

func wait(_ timeout: TimeInterval, until condition: () -> Bool) -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if condition() { return true }
    Thread.sleep(forTimeInterval: 0.1)
  }
  return condition()
}

func press(_ element: AXUIElement) {
  AXUIElementPerformAction(element, kAXPressAction as CFString)
}

struct SystemWindow {
  let id: CGWindowID
  let frame: CGRect
}

func systemWindows(pid: pid_t) -> [SystemWindow] {
  guard
    let rows = CGWindowListCopyWindowInfo([.excludeDesktopElements], kCGNullWindowID)
      as? [[String: AnyObject]]
  else { return [] }
  return rows.compactMap { row in
    guard (row[kCGWindowOwnerPID as String] as? pid_t) == pid,
      let id = row[kCGWindowNumber as String] as? CGWindowID,
      let raw = row[kCGWindowBounds as String] as? [String: AnyObject]
    else { return nil }
    var frame = CGRect.zero
    guard CGRectMakeWithDictionaryRepresentation(raw as CFDictionary, &frame) else { return nil }
    return SystemWindow(id: id, frame: frame)
  }
}

func matchedWindow(_ window: AXUIElement, pid: pid_t) -> SystemWindow? {
  guard let origin = point(window, "AXPosition"), let dimensions = size(window, "AXSize") else {
    return nil
  }
  let frame = CGRect(origin: origin, size: dimensions)
  return systemWindows(pid: pid).first {
    abs($0.frame.origin.x - frame.origin.x) < 4
      && abs($0.frame.origin.y - frame.origin.y) < 4
      && abs($0.frame.width - frame.width) < 4
      && abs($0.frame.height - frame.height) < 4
  }
}

func capture(_ id: CGWindowID, to path: String) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l\(id)", path]
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: path) else {
    throw Failure(step: "screenshot", message: "screencapture did not create \(path)")
  }
}

func dominantColorFraction(_ path: String) throws -> Double {
  guard let data = FileManager.default.contents(atPath: path),
    let bitmap = NSBitmapImageRep(data: data), let pixels = bitmap.bitmapData
  else { throw Failure(step: "screenshot", message: "cannot decode \(path)") }
  let bytes = max(1, bitmap.bitsPerPixel / 8)
  var colors: [UInt32: Int] = [:]
  var samples = 0
  for y in stride(from: 0, to: bitmap.pixelsHigh, by: 4) {
    let row = pixels + y * bitmap.bytesPerRow
    for x in stride(from: 0, to: bitmap.pixelsWide, by: 4) {
      let pixel = row + x * bytes
      let key = UInt32(pixel[0]) << 16 | UInt32(pixel[1]) << 8 | UInt32(pixel[2])
      colors[key, default: 0] += 1
      samples += 1
    }
  }
  return Double(colors.values.max() ?? samples) / Double(max(1, samples))
}

func safeName(_ value: String) -> String {
  value.map { $0.isLetter || $0.isNumber ? String($0) : "-" }
    .joined().replacingOccurrences(of: "--", with: "-")
}

final class Scenario {
  let pid: pid_t
  let artifacts: String
  var window: AXUIElement!
  var index = 1
  var previous: Data?

  init(pid: pid_t, artifacts: String) {
    self.pid = pid
    self.artifacts = artifacts
  }

  func step(_ name: String, action: () throws -> Void) throws {
    print("Step: \(name)")
    try action()
    let path = (artifacts as NSString).appendingPathComponent(
      String(format: "uipath-%02d-%@.png", index, safeName(name)))
    index += 1
    let deadline = Date().addingTimeInterval(5)
    while true {
      guard let matched = matchedWindow(window, pid: pid) else {
        throw Failure(step: name, message: "cannot match the accessibility window to WindowServer")
      }
      try capture(matched.id, to: path)
      let data = try Data(contentsOf: URL(fileURLWithPath: path))
      let blank = try dominantColorFraction(path) >= 0.98
      if !blank && data != previous {
        previous = data
        print("  screenshot: \(path)")
        return
      }
      if Date() >= deadline {
        throw Failure(step: name, message: blank ? "blank screenshot" : "screen did not change")
      }
      Thread.sleep(forTimeInterval: 0.2)
    }
  }
}

func main(appPath: String, dataRoot: String, artifacts: String) throws {
  let executable = (appPath as NSString).appendingPathComponent("Contents/MacOS/localboard")
  guard FileManager.default.isExecutableFile(atPath: executable) else {
    throw Failure(step: "launch", message: "missing executable \(executable)")
  }

  var environment = ProcessInfo.processInfo.environment
  environment["LOCALBOARD_DATA_ROOT"] = dataRoot
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.environment = environment
  try process.run()
  defer {
    if process.isRunning {
      process.terminate()
      process.waitUntilExit()
    }
  }

  let app = AXUIElementCreateApplication(process.processIdentifier)
  let scenario = Scenario(pid: process.processIdentifier, artifacts: artifacts)

  try scenario.step("window shows isolated boards") {
    var found: AXUIElement?
    guard wait(30, until: {
      found = windows(app).first
      return found != nil
    }), let window = found else {
      throw Failure(step: "window shows isolated boards", message: "window did not appear")
    }
    scenario.window = window
    guard let origin = point(window, "AXPosition"), let dimensions = size(window, "AXSize") else {
      throw Failure(step: "window shows isolated boards", message: "window geometry is unavailable")
    }
    var target = CGPoint(x: -(dimensions.width - 40), y: origin.y)
    guard let value = AXValueCreate(.cgPoint, &target) else {
      throw Failure(step: "window shows isolated boards", message: "cannot create AX position")
    }
    AXUIElementSetAttributeValue(window, "AXPosition" as CFString, value)
    guard wait(5, until: { matchedWindow(window, pid: process.processIdentifier) != nil }) else {
      throw Failure(step: "window shows isolated boards", message: "offscreen window cannot be identified")
    }
    var boards: AXUIElement?
    guard wait(15, until: {
      boards = find(window, where: {
        role($0) == "AXButton" && text($0).contains("Доски")
      })
      return boards != nil
    }), let boards else {
      throw Failure(step: "window shows isolated boards", message: "boards button is absent")
    }
    press(boards)
    guard wait(15, until: {
      find(window, where: { text($0).contains("Проверочная схема") }) != nil
        && find(window, where: { text($0).contains("Вторая схема") }) != nil
    }) else {
      print(treeLines(window).joined(separator: "\n"))
      throw Failure(step: "window shows isolated boards", message: "fixture boards are absent")
    }
  }

  try scenario.step("first board opens") {
    guard let board = find(scenario.window, where: {
      role($0) == "AXButton" && text($0).contains("Проверочная схема")
    }) else { throw Failure(step: "first board opens", message: "first board button is absent") }
    press(board)
    guard wait(8, until: {
      ((attribute(scenario.window, "AXTitle") as? String) ?? "").contains("Проверочная схема")
    }) else { throw Failure(step: "first board opens", message: "window title did not change") }
  }

  try scenario.step("second board opens") {
    if find(scenario.window, where: { text($0).contains("Вторая схема") }) == nil {
      guard let boards = find(scenario.window, where: {
        role($0) == "AXButton" && text($0).contains("Доски")
      }) else { throw Failure(step: "second board opens", message: "boards button is absent") }
      press(boards)
      guard wait(5, until: {
        find(scenario.window, where: { text($0).contains("Вторая схема") }) != nil
      }) else { throw Failure(step: "second board opens", message: "boards list did not open") }
    }
    guard let board = find(scenario.window, where: {
      role($0) == "AXButton" && text($0).contains("Вторая схема")
    }) else { throw Failure(step: "second board opens", message: "second board button is absent") }
    press(board)
    guard wait(8, until: {
      ((attribute(scenario.window, "AXTitle") as? String) ?? "").contains("Вторая схема")
    }) else { throw Failure(step: "second board opens", message: "window title did not change") }
  }

  try scenario.step("new board form opens") {
    guard let button = find(scenario.window, where: {
      role($0) == "AXButton" && text($0).contains("Новая доска в этой папке")
    }) else { throw Failure(step: "new board form opens", message: "new-board button is absent") }
    press(button)
    guard wait(5, until: {
      find(scenario.window, where: { text($0).contains("Название доски") }) != nil
        && find(scenario.window, where: { text($0).contains("Создать") }) != nil
    }) else { throw Failure(step: "new board form opens", message: "creation form did not appear") }
  }

  try scenario.step("new board form cancels") {
    guard let cancel = find(scenario.window, where: {
      role($0) == "AXButton" && text($0).contains("Отмена")
    }) else { throw Failure(step: "new board form cancels", message: "cancel button is absent") }
    press(cancel)
    guard wait(5, until: {
      find(scenario.window, where: { text($0).contains("Название доски") }) == nil
    }) else { throw Failure(step: "new board form cancels", message: "creation form remained visible") }
  }
}

guard CommandLine.arguments.count == 4 else {
  FileHandle.standardError.write(
    Data("usage: swift Scenario.swift <LocalBoard.app> <data-root> <artifacts>\n".utf8))
  exit(2)
}

do {
  try main(
    appPath: CommandLine.arguments[1], dataRoot: CommandLine.arguments[2],
    artifacts: CommandLine.arguments[3])
  print("LocalBoard UI acceptance passed")
} catch let failure as Failure {
  FileHandle.standardError.write(Data("UI acceptance failed at \(failure.step): \(failure.message)\n".utf8))
  exit(1)
} catch {
  FileHandle.standardError.write(Data("UI acceptance failed: \(error)\n".utf8))
  exit(1)
}
