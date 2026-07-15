import React, { createContext, useContext, useState } from 'react';
import { Material, MATERIALS, DEFAULT_MATERIAL } from '@/lib/materialState';

export type MaterialName = keyof typeof MATERIALS;

interface MaterialContextType {
  material: Material;
  materialName: MaterialName;
  setMaterialName: (name: MaterialName) => void;
}

const MaterialContext = createContext<MaterialContextType | undefined>(undefined);

export function MaterialProvider({ children }: { children: React.ReactNode }) {
  const [materialName, setMaterialName] = useState<MaterialName>('PLA');
  const material = MATERIALS[materialName];
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
