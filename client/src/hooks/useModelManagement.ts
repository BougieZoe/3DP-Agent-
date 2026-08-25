import { useState, useRef, useCallback, useEffect } from 'react';
import { type UploadedModel } from '@/components/STLUploadHandler';
import { type Material, MATERIALS, defaultMaterialKeyFor } from '@shared/domain/material';
import { type MaterialName } from '@/contexts/MaterialContext';
import { type LengthUnit } from '@shared/domain/geometry';
import { fromThreeBufferGeometry, runAnalysisInWorker } from '@/analysis';
import { normalizeModelGeometry } from '@/lib/modelNormalization';
import { autoOrientGeometry } from '@/lib/autoOrient';
import { createMeshFromGeometry } from '@/lib/stlLoader';
import { toast } from 'sonner';

interface UseModelManagementProps {
  material: Material;
  materialName: MaterialName;
  setMaterialName: (name: MaterialName) => void;
  language: string;
}

export function useModelManagement({ material, materialName, setMaterialName, language }: UseModelManagementProps) {
  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);
  const [models, setModels] = useState<UploadedModel[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [units, setUnits] = useState<LengthUnit>('mm');
  const materialRequestSeq = useRef(0);
  const unitRequestSeq = useRef(0);

  const commitModel = useCallback((updated: UploadedModel) => {
    setUploadedModel(updated);
    setModels(prev =>
      prev.some(m => m.fileName === updated.fileName)
        ? prev.map(m => (m.fileName === updated.fileName ? updated : m))
        : [...prev, updated],
    );
  }, []);

  const activateModel = useCallback((model: UploadedModel, opts?: { skipReset?: boolean }) => {
    setUnits(model.units);
    setActiveFileName(model.fileName);
    setUploadedModel(model);
    toast.success(`Loaded: ${model.fileName}`);
  }, []);

  const handleModelsLoaded = useCallback((loaded: UploadedModel[], received: number) => {
    setModels(loaded);
    const first = loaded[0];
    if (first) activateModel(first);
    if (received > 1) {
      if (loaded.length === received) {
        toast.success(`Loaded ${loaded.length} models`);
      } else {
        toast.error(`Loaded ${loaded.length} of ${received} models`);
      }
    }
  }, [activateModel]);

  const switchModel = useCallback((name: string) => {
    const target = models.find(m => m.fileName === name);
    if (target) activateModel(target);
  }, [models, activateModel]);

  const reanalyzeWithMaterial = useCallback(async (newMaterialName: MaterialName) => {
    setMaterialName(newMaterialName);
    if (!uploadedModel) return;
    const newMat = MATERIALS[newMaterialName];

    materialRequestSeq.current += 1;
    const currentSeq = materialRequestSeq.current;

    const model = fromThreeBufferGeometry(uploadedModel.geometry);
    const newUnified = await runAnalysisInWorker(model, {
      fileName: uploadedModel.fileName,
      material: newMat,
      materialFamily: newMat.technology,
    });

    if (currentSeq !== materialRequestSeq.current) return;
    const updatedModel: UploadedModel = { ...uploadedModel, unifiedAnalysis: newUnified };
    commitModel(updatedModel);
  }, [uploadedModel, commitModel, setMaterialName]);

  const reanalyzeWithFamily = useCallback(async (family: Material['technology']) => {
    const newMaterialKey = defaultMaterialKeyFor(family);
    setMaterialName(newMaterialKey);
    if (!uploadedModel) return;

    materialRequestSeq.current += 1;
    const currentSeq = materialRequestSeq.current;

    const model = fromThreeBufferGeometry(uploadedModel.geometry);
    const newMaterial = MATERIALS[newMaterialKey];
    const newUnified = await runAnalysisInWorker(model, {
      fileName: uploadedModel.fileName,
      material: newMaterial,
      materialFamily: family,
    });

    if (currentSeq !== materialRequestSeq.current) return;
    const updatedModel: UploadedModel = { ...uploadedModel, unifiedAnalysis: newUnified };
    commitModel(updatedModel);
  }, [uploadedModel, commitModel, setMaterialName]);

  const handleUnitsChange = useCallback(async (newUnits: LengthUnit) => {
    setUnits(newUnits);
    if (!uploadedModel?.rawGeometry) return;

    unitRequestSeq.current += 1;
    const currentSeq = unitRequestSeq.current;

    const { geometry: normalizedGeometry } = normalizeModelGeometry(uploadedModel.rawGeometry, newUnits);
    const geometry = autoOrientGeometry(normalizedGeometry);
    const geometryModel = fromThreeBufferGeometry(geometry);
    const newUnified = await runAnalysisInWorker(geometryModel, { fileName: uploadedModel.fileName, material });

    if (currentSeq !== unitRequestSeq.current) return;

    const mesh = createMeshFromGeometry(geometry);
    const updatedModel: UploadedModel = { ...uploadedModel, geometry, mesh, unifiedAnalysis: newUnified, units: newUnits };
    commitModel(updatedModel);
  }, [uploadedModel, material, commitModel]);

  return {
    uploadedModel,
    setUploadedModel,
    models,
    activeFileName,
    units,
    setUnits,
    commitModel,
    activateModel,
    handleModelsLoaded,
    switchModel,
    reanalyzeWithMaterial,
    reanalyzeWithFamily,
    handleUnitsChange,
  };
}
