import { useState } from 'react';
import * as THREE from 'three';
import { applySuggestions, cloneGeometry, countTriangles } from '@/lib/geometryEditor';
import { downloadSTL } from '@/lib/exportService';

interface OptimizeButtonProps {
  geometry: THREE.BufferGeometry;
  suggestions: Array<{ type: string; priority: string }>;
  markers: Array<{ severity: number; position: { x: number; y: number; z: number }; type: string }>;
  originalFileName: string;
  onOptimized?: (geo: THREE.BufferGeometry) => void;
}

export function OptimizeButton({ geometry, suggestions, markers, originalFileName, onOptimized }: OptimizeButtonProps) {
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedGeo, setOptimizedGeo] = useState<THREE.BufferGeometry | null>(null);

  const handleOptimize = async () => {
    setOptimizing(true);
    await new Promise(r => setTimeout(r, 100));

    try {
      const optimized = applySuggestions(geometry, suggestions, markers);
      const before = countTriangles(geometry);
      const after = countTriangles(optimized);

      setOptimizedGeo(optimized);
      onOptimized?.(optimized);

      const baseName = originalFileName.replace('.stl', '');
      const outName = `${baseName}_optimized.stl`;
      downloadSTL(optimized, outName);
    } catch (err) {
      console.error('Optimization failed:', err);
    } finally {
      setOptimizing(false);
    }
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={handleOptimize}
        disabled={optimizing}
        className="w-full py-2.5 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {optimizing ? (
          <><span className="w-2 h-2 bg-primary rounded-full animate-pulse" /> OPTIMIZING...</>
        ) : (
          <><span className="text-sm">⚡</span> GENERATE OPTIMIZED STL</>
        )}
      </button>
      {optimizedGeo && (
        <div className="text-[10px] font-mono text-muted-foreground/50 text-center">
          Optimized STL downloaded • {countTriangles(optimizedGeo)} triangles
        </div>
      )}
    </div>
  );
}

export function downloadReport(reportText: string, fileName: string): void {
  const blob = new Blob([reportText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
