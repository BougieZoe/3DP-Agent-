import { useRef, useState, useCallback } from 'react';
import { createMeshFromGeometry } from '@/lib/stlLoader';
import { loadModelFile } from '@/lib/modelLoader';
import { Language } from '@/lib/i18n';
import { runAnalysisInWorker, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';
import { normalizeModelGeometry } from '@/lib/modelNormalization';
import type { LengthUnit } from '@shared/domain/geometry';
import * as THREE from 'three';

export interface UploadedModel {
  /** Render/analysis geometry: scaled to mm and centered on the build plate. */
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  unifiedAnalysis: UnifiedAnalysis;
  fileName: string;
  fileSizeBytes?: number;
  /** Declared units of the source file; geometry is normalized to mm before analysis. */
  units: LengthUnit;
  /** Pristine clone of the source geometry — the basis for re-processing on unit change. */
  rawGeometry: THREE.BufferGeometry;
}

interface STLUploadHandlerProps {
  /** Called once all selected files have been analyzed (in upload order).
   *  `received` = how many files were passed in, so the caller can tell a
   *  truncated drop (received < picked) from a processing failure. */
  onModelsLoaded: (models: UploadedModel[], received: number) => void;
  onError: (error: string) => void;
  language?: Language;
  /** Declared source units, owned by the parent so a unit change re-processes the model. */
  units: LengthUnit;
  onUnitsChange: (units: LengthUnit) => void;
  /** Print-technology family for the initial analysis (FDM default). */
  materialFamily?: 'fdm' | 'sla' | 'fgf' | 'sls' | 'slm' | 'mjf' | 'concrete' | 'eco';
}

const labels = {
  en: {
    invalidFile: 'Invalid file type — STL, OBJ or 3MF required',
    parseFailed: 'Parse failed: ',
    unknownError: 'Unknown error',
    loading: 'LOADING',
    fileSize: 'FILE SIZE',
    parsing: 'PARSING GEOMETRY...',
    computing: 'COMPUTING NORMALS...',
    analyzing: 'RUNNING ANALYSIS...',
    complete: 'COMPLETE ✓',
    error: 'ERROR',
    drop: '[  DROP  ]',
    stl: '[ STL · OBJ · 3MF ]',
    releaseToUpload: '— RELEASE TO UPLOAD —',
    dragOrClick: 'DRAG FILE HERE OR CLICK TO BROWSE',
    units: 'UNITS',
  },
  ja: {
    invalidFile: '無効なファイル形式 — STL・OBJ・3MFが必要です',
    parseFailed: '解析失敗: ',
    unknownError: '不明なエラー',
    loading: '読み込み中',
    fileSize: 'ファイルサイズ',
    parsing: 'ジオメトリを解析中...',
    computing: ' 法線を計算中...',
    analyzing: '分析を実行中...',
    complete: '完了 ✓',
    error: 'エラー',
    drop: '[  ドロップ  ]',
    stl: '[ STL · OBJ · 3MF ]',
    releaseToUpload: '— リリースしてアップロード —',
    dragOrClick: 'ファイルをドラッグするか、クリックして参照',
    units: '単位',
  },
  zh: {
    invalidFile: '无效的文件类型 — 需要 STL、OBJ 或 3MF',
    parseFailed: '解析失败: ',
    unknownError: '未知错误',
    loading: '加载中',
    fileSize: '文件大小',
    parsing: '正在解析几何体...',
    computing: '正在计算法线...',
    analyzing: '正在运行分析...',
    complete: '完成 ✓',
    error: '错误',
    drop: '[  放下  ]',
    stl: '[ STL · OBJ · 3MF ]',
    releaseToUpload: '— 释放以上传 —',
    dragOrClick: '拖放文件到此处或点击浏览',
    units: '单位',
  },
};

export function STLUploadHandler({ onModelsLoaded, onError, language = 'en', units, onUnitsChange, materialFamily = 'fdm' }: STLUploadHandlerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const t = labels[language];

  const log = (msg: string) => setProgress(p => [...p, msg]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const supported = files.filter((f) => /\.(stl|obj|3mf)$/i.test(f.name));
    if (supported.length !== files.length) {
      onError(t.invalidFile);
    }
    if (supported.length === 0) return;

    setIsLoading(true);
    const results: UploadedModel[] = [];
    for (const file of supported) {
      setProgress([`> ${t.loading} ${file.name}`, `> ${t.fileSize}: ${(file.size / 1024).toFixed(1)} KB`]);
      try {
        // loadModelFile returns the pristine geometry; normalization clones it.
        // 3MF declares its unit in the package — use it instead of the user's
        // pick, so a millimeter 3MF never gets misread as inches.
        const loaded = await loadModelFile(file);
        const effectiveUnits = loaded.units ?? units;
        // Explicit unit contract + viewport centering: scale non-mm models to
        // millimeters, center on the build plate (minZ = 0, XY center = 0), and
        // recompute bounding box / bounding sphere so the camera can frame it.
        const { geometry, rawGeometry } = normalizeModelGeometry(loaded.geometry, effectiveUnits);
        const model = fromThreeBufferGeometry(geometry);
        const unifiedAnalysis = await runAnalysisInWorker(model, { fileName: file.name, materialFamily });
        const mesh = createMeshFromGeometry(geometry);
        results.push({ geometry, mesh, unifiedAnalysis, fileName: file.name, fileSizeBytes: file.size, units: effectiveUnits, rawGeometry });
      } catch (error) {
        log(`> ${t.error} ${file.name}: ${error instanceof Error ? error.message : t.unknownError}`);
      }
    }
    if (results.length > 0) {
      onModelsLoaded(results, supported.length);
    }
    setIsLoading(false);
  }, [onModelsLoaded, onError, t, units]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // dataTransfer.items is the reliable source for multi-file drags — some
    // browsers (Finder drags on macOS) only expose the FIRST file in
    // dataTransfer.files and hide the rest. Fall back to files when items
    // is unavailable.
    const items = Array.from(e.dataTransfer.items ?? []);
    const fromItems = items
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    const fromFiles = Array.from(e.dataTransfer.files ?? []);
    if (fromItems.length > 0) handleFiles(fromItems);
    else if (fromFiles.length > 0) handleFiles(fromFiles);
  };

  if (isLoading) {
    return (
      <div className="border border-primary/30 rounded-sm p-5 bg-card font-mono space-y-1 border-glow">
        {progress.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.includes(t.error) ? 'text-red-400' : msg.includes('✓') ? 'text-emerald-400' : 'text-muted-foreground'}`}>
            {msg}
          </div>
        ))}
        <div className="text-xs text-primary animate-pulse">▋</div>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`
        relative border rounded-sm py-12 px-6 cursor-pointer transition-all duration-200 text-center
        ${isDragging
          ? 'border-primary bg-primary/5 border-glow'
          : 'border-dashed border-border hover:border-primary/50 hover:bg-card'
        }
      `}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.obj,.3mf"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
      />

      <div className="space-y-3">
        <div className="text-3xl font-mono text-primary/30 select-none">
          {isDragging ? t.drop : t.stl}
        </div>

        <div className="text-xs font-mono text-muted-foreground">
          {isDragging ? t.releaseToUpload : t.dragOrClick}
        </div>

        {/* Declared source units — STL carries no unit metadata; changing the
            unit re-processes the model from its raw geometry (no stacked scales)
            and re-runs the analysis. */}
        <div className="flex items-center justify-center gap-1.5 text-xs font-mono">
          <span className="text-muted-foreground/40">{t.units}</span>
          {(['mm', 'cm', 'inch'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={(e) => { e.stopPropagation(); onUnitsChange(u); }}
              className={`px-2 py-0.5 border rounded-sm transition-all ${
                units === u
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground/50 hover:text-primary'
              }`}
            >
              {u === 'inch' ? 'in' : u}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
