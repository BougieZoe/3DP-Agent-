import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  EngineAdapter, Vec3, RenderOptions, RenderResult,
  SceneObject, SceneInfo, ExportResult,
} from './engineAdapter';
import { getToolAction, isCodeSafe, BLENDER_TOOL_POLICY } from './blenderToolPolicy';

const BLENDER_PATH = '/Applications/Blender.app/Contents/MacOS/Blender';
const TMP_DIR = '/tmp/blender-adapter';

export class BlenderAdapter implements EngineAdapter {
  readonly name = 'blender';
  readonly version = '5.2.0';

  private workDir = TMP_DIR;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!existsSync(BLENDER_PATH)) {
      throw new Error(`Blender not found at ${BLENDER_PATH}`);
    }
    const { mkdirSync } = await import('node:fs');
    mkdirSync(this.workDir, { recursive: true });
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  async createMesh(primitive: 'cube' | 'sphere' | 'cylinder' | 'plane', options?: { size?: number; location?: Vec3 }): Promise<SceneObject> {
    const size = options?.size ?? 2;
    const loc = options?.location ?? { x: 0, y: 0, z: 0 };
    const blenderPrimitive = primitive === 'sphere' ? 'uv_sphere' : primitive;
    const sizeParam = primitive === 'sphere' ? 'radius' : 'size';
    const script = `
import bpy, json
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_${blenderPrimitive}_add(${sizeParam}=${size}, location=(${loc.x}, ${loc.y}, ${loc.z}))
obj = bpy.context.active_object
bb = obj.bound_box
info = {
  "name": obj.name,
  "type": obj.type,
  "vertexCount": len(obj.data.vertices),
  "faceCount": len(obj.data.polygons),
  "boundingBox": {
    "min": {"x": bb[0][0], "y": bb[0][1], "z": bb[0][2]},
    "max": {"x": bb[6][0], "y": bb[6][1], "z": bb[6][2]}
  }
}
print("__RESULT__" + json.dumps(info))
`;
    const result = await this.runScript(script);
    return this.parseResult<SceneObject>(result);
  }

  async importMesh(filePath: string): Promise<SceneObject> {
    const ext = filePath.split('.').pop()?.toLowerCase();
    let importCmd: string;
    switch (ext) {
      case 'stl':
        importCmd = `bpy.ops.wm.stl_import(filepath="${filePath}")`;
        break;
      case 'obj':
        importCmd = `bpy.ops.wm.obj_import(filepath="${filePath}")`;
        break;
      case 'glb':
      case 'gltf':
        importCmd = `bpy.ops.wm.gltf_import(filepath="${filePath}")`;
        break;
      default:
        throw new Error(`Unsupported format: ${ext}`);
    }

    const script = `
import bpy, json
bpy.ops.wm.read_factory_settings(use_empty=True)
${importCmd}
obj = bpy.context.active_object
bb = obj.bound_box
info = {
  "name": obj.name,
  "type": obj.type,
  "vertexCount": len(obj.data.vertices),
  "faceCount": len(obj.data.polygons),
  "boundingBox": {
    "min": {"x": bb[0][0], "y": bb[0][1], "z": bb[0][2]},
    "max": {"x": bb[6][0], "y": bb[6][1], "z": bb[6][2]}
  }
}
print("__RESULT__" + json.dumps(info))
`;
    const result = await this.runScript(script);
    return this.parseResult<SceneObject>(result);
  }

  async queryScene(): Promise<SceneInfo> {
    const script = `
import bpy, json
objs = []
for obj in bpy.context.scene.objects:
    bb = obj.bound_box
    objs.append({
        "name": obj.name,
        "type": obj.type,
        "vertexCount": len(obj.data.vertices) if hasattr(obj.data, 'vertices') else 0,
        "faceCount": len(obj.data.polygons) if hasattr(obj.data, 'polygons') else 0,
        "boundingBox": {
            "min": {"x": bb[0][0], "y": bb[0][1], "z": bb[0][2]},
            "max": {"x": bb[6][0], "y": bb[6][1], "z": bb[6][2]}
        }
    })
info = {
    "objects": objs,
    "totalVertices": sum(o["vertexCount"] for o in objs),
    "totalFaces": sum(o["faceCount"] for o in objs)
}
print("__RESULT__" + json.dumps(info))
`;
    const result = await this.runScript(script);
    return this.parseResult<SceneInfo>(result);
  }

  async setMaterial(objectName: string, color: Vec3, roughness = 0.5, metallic = 0.0): Promise<void> {
    const script = `
import bpy
obj = bpy.data.objects["${objectName}"]
mat = bpy.data.materials.new(name="${objectName}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (${color.x}, ${color.y}, ${color.z}, 1.0)
bsdf.inputs["Roughness"].default_value = ${roughness}
bsdf.inputs["Metallic"].default_value = ${metallic}
obj.data.materials.clear()
obj.data.materials.append(mat)
print("__RESULT__ok")
`;
    await this.runScript(script);
  }

  async render(options: RenderOptions): Promise<RenderResult> {
    const engine = options.engine === 'cycles' ? 'CYCLES' : 'BLENDER_EEVEE';
    const cam = options.camera ?? { position: { x: 5, y: -5, z: 5 }, lookAt: { x: 0, y: 0, z: 0 } };
    const outPath = join(this.workDir, `render_${randomBytes(4).toString('hex')}.${options.outputFormat}`);

    const script = `
import bpy
bpy.ops.object.camera_add(location=(${cam.position.x}, ${cam.position.y}, ${cam.position.z}))
cam = bpy.context.active_object
bpy.context.scene.camera = cam
bpy.ops.object.light_add(type='AREA', location=(${cam.position.x}, ${cam.position.y}, ${cam.position.z + 3}))
light = bpy.context.active_object
light.data.energy = 500
scene = bpy.context.scene
scene.render.engine = '${engine}'
scene.render.resolution_x = ${options.width}
scene.render.resolution_y = ${options.height}
scene.render.filepath = '${outPath}'
bpy.ops.render.render(write_still=True)
print("__RESULT__" + '${outPath}')
`;
    await this.runScript(script);
    const stats = await stat(outPath);
    return {
      imagePath: outPath,
      width: options.width,
      height: options.height,
      fileSizeBytes: stats.size,
    };
  }

  async export(filePath: string, format: 'stl' | 'obj' | 'glb'): Promise<ExportResult> {
    let exportCmd: string;
    switch (format) {
      case 'stl':
        exportCmd = `bpy.ops.wm.stl_export(filepath="${filePath}")`;
        break;
      case 'obj':
        exportCmd = `bpy.ops.wm.obj_export(filepath="${filePath}")`;
        break;
      case 'glb':
        exportCmd = `bpy.ops.wm.gltf_export(filepath="${filePath}")`;
        break;
    }

    const script = `
import bpy
${exportCmd}
print("__RESULT__ok")
`;
    await this.runScript(script);
    const stats = await stat(filePath);
    return { filePath, fileSizeBytes: stats.size };
  }

  // ── Internal ──

  private async runScript(pythonCode: string): Promise<string> {
    this.ensureInitialized();

    const safety = isCodeSafe(pythonCode, BLENDER_TOOL_POLICY);
    if (!safety.safe) {
      throw new Error(`Code blocked by policy: ${safety.violations.join('; ')}`);
    }

    const tmpFile = join(this.workDir, `script_${randomBytes(4).toString('hex')}.py`);
    await writeFile(tmpFile, pythonCode, 'utf-8');

    return new Promise((resolve, reject) => {
      execFile(BLENDER_PATH, ['--background', '--python', tmpFile], {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Blender error: ${error.message}\n${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  private parseResult<T>(stdout: string): T {
    const match = stdout.match(/__RESULT__(.*)/m);
    if (!match) throw new Error(`No __RESULT__ in Blender output:\n${stdout}`);
    return JSON.parse(match[1]) as T;
  }

  private ensureInitialized() {
    if (!this.initialized) throw new Error('BlenderAdapter not initialized. Call init() first.');
  }
}
