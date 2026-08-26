import { useRef, useState, useCallback } from 'react';
import { createMeshFromGeometry } from '@/lib/stlLoader';
import { loadModelFile } from '@/lib/modelLoader';
import { Language } from '@/lib/i18n';
import { runAnalysisInWorker, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';
import { normalizeModelGeometry } from '@/lib/modelNormalization';
import { autoOrientGeometry } from '@/lib/autoOrient';
import { geometryToStl } from '@/lib/meshOps';
import { sliceSTL, type SliceMetadata, type SliceProvenance, type SlicerId } from '@/lib/sliceClient';
import { getCachedAnalysis, setCachedAnalysis, hashFileBytes, cacheKeyFromParts } from '@/lib/analysisCache';
import { notifyAnalysisComplete } from '@/lib/notifications';
import { DEFAULT_MATERIAL } from '@shared/domain/material';
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
  /** Ground-truth print metrics from real slicer G-code (when available). */
  sliceMetadata?: SliceMetadata;
  /** Provenance info tracking the data source (slicer vs estimate). */
  sliceProvenance?: SliceProvenance;
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
    uploadFailed: 'Failed to load file — see console for details',
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
    uploadFailed: 'ファイルの読み込みに失敗しました — コンソールを確認してください',
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
    uploadFailed: '文件加载失败 — 详情见控制台',
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
    const startTime = Date.now();
    let lastError: string | null = null;

    // Check device memory — warn on low-memory devices
    const nav = navigator as Navigator & { deviceMemory?: number };
    const deviceMemoryGB = nav.deviceMemory ?? 4;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    for (const file of supported) {
      const sizeMB = file.size / (1024 * 1024);
      const sizeLabel = sizeMB >= 1
        ? `${sizeMB.toFixed(1)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;
      setProgress([`> ${t.loading} ${file.name}`, `> ${t.fileSize}: ${sizeLabel}`]);

      // Warn for large files on mobile
      if (isMobile && sizeMB > 30) {
        setProgress(p => [...p, `> ⚠ Large file on mobile — may be slow`]);
      }
      if (sizeMB > 50) {
        setProgress(p => [...p, `> ⚠ Large file — analysis may take a while`]);
      }

      // Check available memory before loading
      if (isMobile && sizeMB > deviceMemoryGB * 50) {
        setProgress(p => [...p, `> ⚠ File too large for device memory (${deviceMemoryGB}GB RAM)`]);
        log(`> SKIPPED ${file.name}: Would exceed device memory`);
        lastError = t.uploadFailed;
        continue;
      }
      try {
        // Read the file ONCE. The buffer is hashed for the cache, then
        // TRANSFERRED into the parse worker — no second full-size allocation
        // (the old flow held two copies of every large STL in memory).
        log(`> READING ${file.name}...`);
        const arrayBuffer = await file.arrayBuffer();
        const pipelineOptions = { fileName: file.name, materialFamily };

        // Hash BEFORE transferring the buffer to the worker — after the
        // transfer the buffer is detached and the hash cannot be recomputed.
        const fileHash = await hashFileBytes(arrayBuffer);
        const cacheKey = await cacheKeyFromParts(fileHash, pipelineOptions);

        // Geometry + analysis — cache hit skips the pipeline but still needs
        // the BufferGeometry for slicing and 3-D display.
        log(`> PARSING ${file.name}...`);
        const loaded = await loadModelFile(file, arrayBuffer);
        log(`> PARSED OK`);

        const effectiveUnits = loaded.units ?? units;
        const { geometry: normalizedGeometry, rawGeometry } = normalizeModelGeometry(loaded.geometry, effectiveUnits);
        // Auto-orient so the model sits naturally on the build plate
        const geometry = autoOrientGeometry(normalizedGeometry);

        // Check analysis cache before running pipeline
        const cached = await getCachedAnalysis(null, pipelineOptions, cacheKey);
        let unifiedAnalysis: UnifiedAnalysis;
        if (cached) {
          log(`> CACHE HIT — reusing cached result for ${file.name}`);
          unifiedAnalysis = cached.result;
        } else {
          const model = fromThreeBufferGeometry(geometry);
          log(`> ANALYZING ${file.name}...`);
          unifiedAnalysis = await runAnalysisInWorker(model, pipelineOptions);
          // Cache the result for future uploads
          await setCachedAnalysis(null, pipelineOptions, unifiedAnalysis, file.name, file.size, { cacheKey, fileHash });
        }

        // Slice STL to get ground-truth print metrics (time, filament, layers).
        // Only for STL files (binary format) — OBJ/3MF go through estimate path.
        let sliceMetadata: SliceMetadata | undefined;
        let sliceProvenance: SliceProvenance | undefined;
        if (file.name.toLowerCase().endsWith('.stl')) {
          try {
            log(`> SLICING ${file.name}...`);
            const stlBytes = geometryToStl(geometry);
            const sliceResult = await sliceSTL({
              stlBytes,
              fileName: file.name,
              slicer: 'prusaslicer',
              autoDropToBed: true,
            });
            sliceMetadata = sliceResult.metadata;
            sliceProvenance = {
              slicerId: 'prusaslicer',
              slicedAt: new Date().toISOString(),
              profileUsed: 'default',
              autoDropToBed: true,
            };
            log(`> SLICE COMPLETE: ${sliceMetadata.printTimeMinutes.toFixed(1)}min, ${sliceMetadata.filamentGrams.toFixed(1)}g`);
          } catch (err) {
            // Slice failure does not block upload — fall back to volume estimates.
            console.warn('[STLUploadHandler] slice failed, using estimates:', err);
            log(`> SLICE UNAVAILABLE (using estimates)`);
          }
        }

        const mesh = createMeshFromGeometry(geometry);
        results.push({
          geometry,
          mesh,
          unifiedAnalysis,
          fileName: file.name,
          fileSizeBytes: file.size,
          units: effectiveUnits,
          rawGeometry,
          sliceMetadata,
          sliceProvenance,
        });

        // Fire-and-forget notifications (webhook/email) — don't block the UI
        notifyAnalysisComplete(file.name, unifiedAnalysis, DEFAULT_MATERIAL, Date.now() - startTime)
          .catch(() => {});
      } catch (error) {
        console.error('[STLUploadHandler] processing failed:', error);
        const msg = error instanceof Error ? error.message : t.unknownError;
        log(`> ${t.error} ${file.name}: ${msg}`);
        lastError = `${t.parseFailed}${msg}`;
      }
    }
    if (results.length > 0) {
      onModelsLoaded(results, supported.length);
    } else if (lastError) {
      // Every file failed — surface a real error instead of silently resetting
      // to the upload box (the previous "no error message" crash UX).
      onError(lastError);
    }
    setIsLoading(false);
  }, [onModelsLoaded, onError, t, units, materialFamily]);

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
    // Compute a rough progress estimate from the log messages
    const total = progress.length;
    const done = progress.filter(m => m.includes('✓') || m.includes('COMPLETE') || m.includes('CACHE HIT')).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
      <div className="border border-primary/30 rounded-sm p-5 bg-card font-mono space-y-2 border-glow">
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-border/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/70 rounded-full transition-all duration-300"
            style={{ width: `${Math.max(pct, 5)}%` }}
          />
        </div>
        <div className="text-[10px] text-muted-foreground/50 text-right">{pct}%</div>

        {/* Log lines */}
        {progress.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.includes(t.error) ? 'text-red-400' : msg.includes('✓') || msg.includes('CACHE HIT') ? 'text-emerald-400' : 'text-muted-foreground'}`}>
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
