// Apple Object Capture (PhotogrammetrySession) driver for macOS.
//
// Why: COLMAP's dense stereo requires CUDA, so on Apple silicon a COLMAP-only install can
// never produce a mesh — it stops at a sparse cloud. Apple's Object Capture runs on the
// same machine through Metal and produces a real mesh from the same photos. Adding an
// engine is allowed by the contract; changing the contract is not.
//
// Contract with the TypeScript provider:
// - argv: <images-dir> <output-obj-path> <progress-json-path> <detail: preview|reduced|medium|full|raw>
// - Writes progress JSON with {"stage":..., "percent":...}; "completed" only after the mesh
//   file exists on disk. A failure writes {"stage":"failed","error":...} and exits non-zero.
// - Never fabricates success: if the session cannot produce a mesh, this exits non-zero.
import Foundation
import RealityKit

func writeProgress(_ path: String, _ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else { return }
    try? data.write(to: URL(fileURLWithPath: path))
}

func fail(_ path: String, _ message: String, _ code: Int32) -> Never {
    writeProgress(path, ["stage": "failed", "percent": 0, "error": message, "failed_at": ISO8601DateFormatter().string(from: Date())])
    FileHandle.standardError.write(Data("[applePhotogrammetry] \(message)\n".utf8))
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 5 else {
    FileHandle.standardError.write(Data("usage: applePhotogrammetry <images-dir> <out.obj> <progress.json> <detail>\n".utf8))
    exit(2)
}

let imagesDir = args[1]
let outputPath = args[2]
let progressPath = args[3]
let detailName = args[4]

let detail: PhotogrammetrySession.Request.Detail
switch detailName {
case "preview": detail = .preview
case "reduced": detail = .reduced
case "medium": detail = .medium
case "raw": detail = .raw
default: detail = .full
}

var configuration = PhotogrammetrySession.Configuration()
// Sequential capture order is the common phone-scan case; it also stabilises the
// reconstruction on small sets.
configuration.sampleOrdering = .sequential
configuration.featureSensitivity = .high

writeProgress(progressPath, ["stage": "loading_images", "percent": 5])

let session: PhotogrammetrySession
do {
    session = try PhotogrammetrySession(input: URL(fileURLWithPath: imagesDir), configuration: configuration)
} catch {
    fail(progressPath, "Object Capture could not read the images: \(error)", 1)
}

let outputURL = URL(fileURLWithPath: outputPath)
try? FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try? FileManager.default.removeItem(at: outputURL)

let semaphore = DispatchSemaphore(value: 0)
var failureMessage: String?
let lock = NSLock()

func markFailure(_ message: String) {
    lock.lock()
    if failureMessage == nil { failureMessage = message }
    lock.unlock()
}

let request = PhotogrammetrySession.Request.modelFile(url: outputURL, detail: detail)

// Progress is derived from the session's own messages rather than from a timer, so a
// reported percentage always reflects work the engine says it has finished.
let monitor = Task {
    do {
        for try await output in session.outputs {
            switch output {
            case .requestProgress(_, let fraction):
                writeProgress(progressPath, [
                    "stage": "reconstructing",
                    "percent": max(10, min(95, Int(fraction * 100))),
                    "updated_at": ISO8601DateFormatter().string(from: Date()),
                ])
            case .requestComplete(_, let result):
                switch result {
                case .modelFile(let url):
                    writeProgress(progressPath, [
                        "stage": "mesh_written",
                        "percent": 96,
                        "mesh": url.path,
                        "updated_at": ISO8601DateFormatter().string(from: Date()),
                    ])
                default:
                    markFailure("Object Capture finished with an unexpected result: \(result)")
                }
                semaphore.signal()
            case .requestError(_, let error):
                markFailure("Object Capture failed: \(error)")
                semaphore.signal()
            case .processingComplete:
                semaphore.signal()
            case .processingCancelled:
                markFailure("Object Capture was cancelled.")
                semaphore.signal()
            default:
                break
            }
        }
    } catch {
        markFailure("Object Capture output stream failed: \(error)")
        semaphore.signal()
    }
}

do {
    try session.process(requests: [request])
} catch {
    monitor.cancel()
    fail(progressPath, "Object Capture could not start: \(error)", 1)
}

// 60 minutes: a full-detail run on a large set is slow, but a silent hang is worse.
let waitResult = semaphore.wait(timeout: .now() + 3600)
monitor.cancel()

if waitResult == .timedOut {
    session.cancel()
    fail(progressPath, "Object Capture timed out after 60 minutes.", 1)
}

if let message = failureMessage {
    fail(progressPath, message, 1)
}

guard FileManager.default.fileExists(atPath: outputPath) else {
    fail(progressPath, "Object Capture reported completion but no mesh file was written.", 1)
}

let attributes = try? FileManager.default.attributesOfItem(atPath: outputPath)
let bytes = (attributes?[.size] as? NSNumber)?.intValue ?? 0
writeProgress(progressPath, [
    "stage": "completed",
    "percent": 100,
    "mesh": outputPath,
    "bytes": bytes,
    "updated_at": ISO8601DateFormatter().string(from: Date()),
])
FileHandle.standardError.write(Data("[applePhotogrammetry] wrote \(outputPath) (\(bytes) bytes)\n".utf8))
