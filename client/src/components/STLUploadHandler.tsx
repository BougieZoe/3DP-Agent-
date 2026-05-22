import { useRef, useState, useCallback } from 'react';
import { loadSTLFile, createMeshFromGeometry } from '@/lib/stlLoader';
import { Language } from '@/lib/i18n';
import { runAnalysisPipeline, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';
import * as THREE from 'three';

export interface UploadedModel {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  unifiedAnalysis: UnifiedAnalysis;
  fileName: string;
  fileSizeBytes?: number;
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
  },
};

export function STLUploadHandler({ onModelLoaded, onError, language = 'en' }: STLUploadHandlerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
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
      log(`> ${t.computing}`);
      const model = fromThreeBufferGeometry(geometry);
      const unifiedAnalysis = runAnalysisPipeline(model, { fileName: file.name });
      log(`> ${t.analyzing}`);
      const mesh = createMeshFromGeometry(geometry);
      log(`> ${t.complete}`);

      setTimeout(() => {
        onModelLoaded({ geometry, mesh, unifiedAnalysis, fileName: file.name, fileSizeBytes: file.size });
        setIsLoading(false);
      }, 400);
    } catch (error) {
      log(`> ${t.error}: ${error instanceof Error ? error.message : t.unknownError}`);
      onError(`${t.parseFailed}${error instanceof Error ? error.message : t.unknownError}`);
      setIsLoading(false);
    }
  }, [onModelLoaded, onError, t]);

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
      </div>
    </div>
  );
}
