// Converts an Apple Object Capture result (USDZ, which is a zipped USD package) into a
// binary STL using ModelIO — no external USD tooling, no Python dependency.
//
// Object Capture only writes USDZ; the contract promises STL, so the conversion lives here
// rather than being pushed onto the caller. If the conversion cannot read the asset it
// exits non-zero: a corrupt or empty mesh must never be reported as a finished job.
//
// Usage: appleMeshConvert <input.usdz> <output.stl>
import Foundation
import ModelIO
import SceneKit

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data("[appleMeshConvert] \(message)\n".utf8))
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(Data("usage: appleMeshConvert <input.usdz> <output.stl>\n".utf8))
    exit(2)
}

let inputURL = URL(fileURLWithPath: args[1])
let outputURL = URL(fileURLWithPath: args[2])

guard FileManager.default.fileExists(atPath: inputURL.path) else {
    fail("input not found: \(inputURL.path)", 1)
}

let asset = MDLAsset(url: inputURL)
asset.loadTextures()

var meshes: [MDLMesh] = asset.childObjects(of: MDLMesh.self) as? [MDLMesh] ?? []
if meshes.isEmpty {
    // Some USD packages nest the mesh under an entity; walk the object tree as a fallback.
    func walk(_ object: MDLObject) {
        if let mesh = object as? MDLMesh {
            meshes.append(mesh)
            return
        }
        for child in object.children.objects {
            walk(child)
        }
    }
    for index in 0..<asset.count {
        walk(asset.object(at: index))
    }
}

guard !meshes.isEmpty else {
    fail("no mesh found in \(inputURL.lastPathComponent)", 1)
}

var triangles: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] = []

for mesh in meshes {
    guard let positionAttribute = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributePosition, as: .float3) else {
        continue
    }
    let vertexCount = mesh.vertexCount
    let stride = positionAttribute.stride
    let base = positionAttribute.dataStart

    func position(_ index: Int) -> SIMD3<Float> {
        let floats = (base + index * stride).assumingMemoryBound(to: Float.self)
        return SIMD3<Float>(floats[0], floats[1], floats[2])
    }

    for submesh in mesh.submeshes ?? [] {
        guard let submesh = submesh as? MDLSubmesh else { continue }
        let indexCount = submesh.indexCount
        let indexBuffer = submesh.indexBuffer

        // Index width comes from the submesh's declared index type, not from the buffer:
        // MDLMeshBuffer has no stride of its own.
        let indexWidth = submesh.indexType == .uInt16 ? 2 : 4
        let map = indexBuffer.map()

        func index(at position: Int) -> Int {
            let pointer = map.bytes.advanced(by: position * indexWidth)
            switch submesh.indexType {
            case .uInt16:
                return Int(pointer.assumingMemoryBound(to: UInt16.self).pointee)
            case .uInt32:
                return Int(pointer.assumingMemoryBound(to: UInt32.self).pointee)
            default:
                return position
            }
        }

        var cursor = 0
        while cursor + 2 < indexCount {
            let indices = [index(at: cursor), index(at: cursor + 1), index(at: cursor + 2)]
            if indices.allSatisfy({ $0 >= 0 && $0 < vertexCount }) {
                triangles.append((position(indices[0]), position(indices[1]), position(indices[2])))
            }
            cursor += 3
        }
    }
}

guard !triangles.isEmpty else {
    fail("mesh contained no triangles", 1)
}

var data = Data(capacity: 84 + triangles.count * 50)
var header = [UInt8](repeating: 0, count: 80)
let banner = Array("3DP-Agent photo-to-cad (Object Capture)".utf8)
header.replaceSubrange(0..<min(banner.count, 80), with: banner.prefix(80))
data.append(contentsOf: header)
var count = UInt32(triangles.count).littleEndian
withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }

for triangle in triangles {
    let (a, b, c) = triangle
    let normal = simd_cross(b - a, c - a)
    let length = simd_length(normal)
    let unit = length > 0 ? normal / length : SIMD3<Float>(0, 0, 0)
    for value in [unit.x, unit.y, unit.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z] {
        var little = value.bitPattern.littleEndian
        withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }
    var attribute = UInt16(0).littleEndian
    withUnsafeBytes(of: &attribute) { data.append(contentsOf: $0) }
}

try? FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
do {
    try data.write(to: outputURL)
} catch {
    fail("could not write \(outputURL.path): \(error)", 1)
}

FileHandle.standardError.write(
    Data("[appleMeshConvert] \(triangles.count) triangles -> \(outputURL.lastPathComponent) (\(data.count) bytes)\n".utf8)
)
