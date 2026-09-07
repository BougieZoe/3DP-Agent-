export interface Vec3 { x: number; y: number; z: number; }

export interface RenderOptions {
  width: number;
  height: number;
  engine: 'eevee' | 'cycles';
  camera?: { position: Vec3; lookAt: Vec3 };
  outputFormat: 'png' | 'jpg';
}

export interface RenderResult {
  imagePath: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

export interface SceneObject {
  name: string;
  type: string;
  vertexCount: number;
  faceCount: number;
  boundingBox: { min: Vec3; max: Vec3 };
}

export interface SceneInfo {
  objects: SceneObject[];
  totalVertices: number;
  totalFaces: number;
}

export interface ExportResult {
  filePath: string;
  fileSizeBytes: number;
}

export interface EngineAdapter {
  readonly name: string;
  readonly version: string;

  /** Start the engine (if not already running) */
  init(): Promise<void>;

  /** Shut down the engine */
  dispose(): Promise<void>;

  /** Create a primitive mesh */
  createMesh(primitive: 'cube' | 'sphere' | 'cylinder' | 'plane', options?: { size?: number; location?: Vec3 }): Promise<SceneObject>;

  /** Import mesh from file (STL, OBJ, GLB) */
  importMesh(filePath: string): Promise<SceneObject>;

  /** Query scene contents */
  queryScene(): Promise<SceneInfo>;

  /** Set material on object */
  setMaterial(objectName: string, color: Vec3, roughness?: number, metallic?: number): Promise<void>;

  /** Set up camera and lights, then render */
  render(options: RenderOptions): Promise<RenderResult>;

  /** Export scene to file */
  export(filePath: string, format: 'stl' | 'obj' | 'glb'): Promise<ExportResult>;
}
