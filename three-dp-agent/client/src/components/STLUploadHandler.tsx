import { useRef, useState } from 'react';
import { loadSTLFile, analyzeModel, createMeshFromGeometry } from '@/lib/stlLoader';
import { LoadingAnimation } from './LoadingAnimation';
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

  const handleFileSelect = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.stl')) {
      onError('Please upload a valid STL file');
      return;
    }

    setIsLoading(true);

    try {
      const geometry = await loadSTLFile(file);
      const analysis = analyzeModel(geometry);
      const mesh = createMeshFromGeometry(geometry);

      onModelLoaded({
        geometry,
        mesh,
        analysis,
        fileName: file.name,
      });
    } catch (error) {
      onError(`Failed to load STL file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  if (isLoading) {
    return (
      <div className="border-2 border-dashed border-border rounded-lg p-12">
        <LoadingAnimation message="Processing STL file..." />
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-accent transition-colors cursor-pointer"
    >
      <div className="space-y-3">
        <div className="font-mono text-sm text-muted-foreground">
          Drag STL file here or click to upload
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".stl"
          className="hidden"
          id="stl-upload"
          onChange={handleInputChange}
          disabled={isLoading}
        />
        <label htmlFor="stl-upload" className="block cursor-pointer">
          <div className="font-serif text-lg text-accent hover:text-primary transition-colors">
            Upload Model
          </div>
        </label>
      </div>
    </div>
  );
}
