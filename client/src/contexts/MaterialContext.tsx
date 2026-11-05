import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Material, MATERIALS } from '@shared/domain/material';
import { readPref, writePref } from '@/lib/prefs';

export type MaterialName = keyof typeof MATERIALS;

interface MaterialContextType {
  material: Material;
  materialName: MaterialName;
  setMaterialName: (name: MaterialName) => void;
}

const MaterialContext = createContext<MaterialContextType | undefined>(undefined);

/** Material is part of the analysis setup — it survives a reload. */
const MATERIAL_KEYS = Object.keys(MATERIALS) as MaterialName[];

export function MaterialProvider({ children }: { children: React.ReactNode }) {
  const [materialName, setMaterialNameState] = useState<MaterialName>(() =>
    readPref('material', MATERIAL_KEYS, 'PLA'),
  );
  const material = MATERIALS[materialName];

  useEffect(() => {
    writePref('material', materialName);
  }, [materialName]);

  const setMaterialName = useCallback((name: MaterialName) => {
    setMaterialNameState(name);
  }, []);

  return (
    <MaterialContext.Provider value={{ material, materialName, setMaterialName }}>
      {children}
    </MaterialContext.Provider>
  );
}

export function useMaterial(): MaterialContextType {
  const context = useContext(MaterialContext);
  if (!context) throw new Error('useMaterial must be used within MaterialProvider');
  return context;
}
