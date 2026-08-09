import { useRef, useState, useCallback } from 'react';
import { loadSTLFile, createMeshFromGeometry } from '@/lib/stlLoader';
import { Language } from '@/lib/i18n';
import { runAnalysisPipeline, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';
import { LENGTH_UNIT_TO_MM, type LengthUnit } from '@shared/domain/geometry';
import * as THREE from 'three';

export interface UploadedModel {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  unifiedAnalysis: UnifiedAnalysis;
  fileName: string;
  fileSizeBytes?: number;
  /** Declared units of the source file; geometry is normalized to mm before analysis. */
  units: LengthUnit;
}

interface STLUploadHandlerProps {
  onModelLoaded: (model: UploadedModel) => void;
  onError: (error: string) => void;
  language?: Language;
}

const labels = {
  en: {
    invalidFile: 'Invalid file type — STL required',
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
    stl: '[  STL  ]',
    releaseToUpload: '— RELEASE TO UPLOAD —',
    dragOrClick: 'DRAG FILE HERE OR CLICK TO BROWSE',
    supported: 'Binary & ASCII STL supported',
    units: 'UNITS',
  },
  ja: {
    invalidFile: '無効なファイル形式 — STLが必要です',
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
    stl: '[  STL  ]',
    releaseToUpload: '— リリースしてアップロード —',
    dragOrClick: 'ファイルをドラッグするか、クリックして参照',
    supported: 'バイナリ＆ASCII STL対応',
    units: '単位',
  },
  zh: {
    invalidFile: '无效的文件类型 — 需要 STL',
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
    stl: '[  STL  ]',
    releaseToUpload: '— 释放以上传 —',
    dragOrClick: '拖放文件到此处或点击浏览',
    supported: '支持二进制和 ASCII STL',
    units: '单位',
  },
};

export function STLUploadHandler({ onModelLoaded, onError, language = 'en' }: STLUploadHandlerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [units, setUnits] = useState<LengthUnit>('mm');
  const t = labels[language];

  const log = (msg: string) => setProgress(p => [...p, msg]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.stl')) {
      onError(t.invalidFile);
      return;
    }
    setIsLoading(true);
    setProgress([]);
    log(`> ${t.loading} ${file.name}`);
    log(`> ${t.fileSize}: ${(file.size / 1024).toFixed(1)} KB`);

    try {
      log(`> ${t.parsing}`);
      const geometry = await loadSTLFile(file);
      // Explicit unit contract: a non-mm STL is scaled to millimeters here so
      // every downstream metric (dimensions, volume, weight, bed fit) is in mm.
      // The declared source units are recorded on the model for provenance.
      if (units !== 'mm') {
        const f = LENGTH_UNIT_TO_MM[units];
        geometry.scale(f, f, f);
      }
      log(`> ${t.computing}`);
      const model = fromThreeBufferGeometry(geometry);
      const unifiedAnalysis = runAnalysisPipeline(model, { fileName: file.name });
      log(`> ${t.analyzing}`);
      const mesh = createMeshFromGeometry(geometry);
      log(`> ${t.complete}`);

      setTimeout(() => {
        onModelLoaded({ geometry, mesh, unifiedAnalysis, fileName: file.name, fileSizeBytes: file.size, units });
        setIsLoading(false);
      }, 400);
    } catch (error) {
      log(`> ${t.error}: ${error instanceof Error ? error.message : t.unknownError}`);
      onError(`${t.parseFailed}${error instanceof Error ? error.message : t.unknownError}`);
      setIsLoading(false);
    }
  }, [onModelLoaded, onError, t, units]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
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
        relative border rounded-sm p-6 cursor-pointer transition-all duration-200 text-center
        ${isDragging
          ? 'border-primary bg-primary/5 border-glow'
          : 'border-dashed border-border hover:border-primary/50 hover:bg-card'
        }
      `}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
      />

      <div className="space-y-3">
        <div className="text-3xl font-mono text-primary/30 select-none">
          {isDragging ? t.drop : t.stl}
        </div>

        <div className="text-xs font-mono text-muted-foreground">
          {isDragging ? t.releaseToUpload : t.dragOrClick}
        </div>
        <div className="text-xs text-muted-foreground/40">
          {t.supported}
        </div>

        {/* Declared source units — STL carries no unit metadata; non-mm models
            are scaled to mm before analysis instead of being silently misread. */}
        <div className="flex items-center justify-center gap-1.5 text-xs font-mono">
          <span className="text-muted-foreground/40">{t.units}</span>
          {(['mm', 'cm', 'inch'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={(e) => { e.stopPropagation(); setUnits(u); }}
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
