import { useRef, useState, useCallback } from 'react';
import { loadSTLFile, createMeshFromGeometry } from '@/lib/stlLoader';
import { analyzeModel } from '@/lib/stlPipeline';
import type { ModelAnalysis, WorkflowStageResult } from '../../../shared/domain/analysis';
import * as THREE from 'three';

export interface UploadedModel {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  analysis: ModelAnalysis;
  stages: WorkflowStageResult[];
  fileName: string;
}

interface STLUploadHandlerProps {
  onModelLoaded: (model: UploadedModel) => void;
  onError: (error: string) => void;
}

export function STLUploadHandler({ onModelLoaded, onError }: STLUploadHandlerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);

  const log = (msg: string) => setProgress(p => [...p, msg]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.stl')) {
      onError('Invalid file type — STL required');
      return;
    }

    setIsLoading(true);
    setProgress([]);
    log(`> LOADING ${file.name}`);
    log(`> FILE SIZE: ${(file.size / 1024).toFixed(1)} KB`);

    try {
      // Stage 1: parse geometry (Three.js runtime artifact — stays here)
      log('> PARSING GEOMETRY...');
      const geometry = await loadSTLFile(file);
      const mesh = createMeshFromGeometry(geometry);

      // Stage 2: run pipeline → produces serializable ModelAnalysis
      log('> RUNNING PIPELINE...');
      const { analysis, stages } = await analyzeModel(file);

      stages.forEach(s => log(`> ${s.stage}: ${s.status} ${s.durationMs ? `(${s.durationMs}ms)` : ''}`));
      log('> COMPLETE ✓');

      setTimeout(() => {
        onModelLoaded({ geometry, mesh, analysis, stages, fileName: file.name });
        setIsLoading(false);
      }, 400);

    } catch (error) {
      log(`> ERROR: ${error instanceof Error ? error.message : 'Unknown'}`);
      onError(`Parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  }, [onModelLoaded, onError]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer
        ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
      />

      {isLoading ? (
        <div className="font-mono text-xs text-muted-foreground space-y-1 text-left w-full">
          {progress.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      ) : (
        <>
          <div className="text-2xl font-mono text-primary mb-2">[ STL ]</div>
          <p className="text-sm text-muted-foreground">DRAG FILE HERE OR CLICK TO BROWSE</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Binary &amp; ASCII STL supported</p>
        </>
      )}
    </div>
  );
}