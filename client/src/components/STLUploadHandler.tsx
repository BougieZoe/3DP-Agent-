import { useRef, useState, useCallback } from 'react';
import { loadSTLFile, analyzeModel, createMeshFromGeometry } from '@/lib/stlLoader';
import * as THREE from 'three';

export interface UploadedModel {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  analysis: ReturnType<typeof analyzeModel>;
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
      log('> PARSING GEOMETRY...');
      const geometry = await loadSTLFile(file);
      log('> COMPUTING NORMALS...');
      const analysis = analyzeModel(geometry);
      log('> RUNNING ANALYSIS...');
      const mesh = createMeshFromGeometry(geometry);
      log('> COMPLETE ✓');

      setTimeout(() => {
        onModelLoaded({ geometry, mesh, analysis, fileName: file.name });
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

  if (isLoading) {
    return (
      <div className="border border-primary/30 rounded-sm p-5 bg-card font-mono space-y-1 border-glow">
        {progress.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.includes('ERROR') ? 'text-red-400' : msg.includes('✓') ? 'text-emerald-400' : 'text-muted-foreground'}`}>
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
        {/* Icon */}
        <div className="text-3xl font-mono text-primary/30 select-none">
          {isDragging ? '[  DROP  ]' : '[  STL  ]'}
        </div>

        <div className="text-xs font-mono text-muted-foreground">
          {isDragging ? '— RELEASE TO UPLOAD —' : 'DRAG FILE HERE OR CLICK TO BROWSE'}
        </div>
        <div className="text-xs text-muted-foreground/40">
          Binary & ASCII STL supported
        </div>
      </div>
    </div>
  );
}
