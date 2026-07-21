import * as THREE from 'three';

export interface CADMaterialPreset {
  id: string;
  label: string;
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  ior?: number;
}

export const CAD_MATERIALS: CADMaterialPreset[] = [
  {
    id: 'electric-blue',
    label: 'Electric Blue',
    color: '#3B82F6',
    metalness: 0.55,
    roughness: 0.25,
    clearcoat: 0.30,
    clearcoatRoughness: 0.20,
    envMapIntensity: 1.4,
    ior: 1.5,
  },
  {
    id: 'industrial-gray',
    label: 'Industrial Gray',
    color: '#c0c0c0',
    metalness: 0.15,
    roughness: 0.32,
    clearcoat: 0.25,
    clearcoatRoughness: 0.30,
    envMapIntensity: 0.6,
  },
  {
    id: 'titanium',
    label: 'Titanium',
    color: '#a8a9ad',
    metalness: 0.70,
    roughness: 0.20,
    clearcoat: 0.10,
    clearcoatRoughness: 0.40,
    envMapIntensity: 1.0,
  },
  {
    id: 'aluminum',
    label: 'Aluminum',
    color: '#c0c0c0',
    metalness: 0.80,
    roughness: 0.15,
    clearcoat: 0.10,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.2,
  },
  {
    id: 'ceramic-white',
    label: 'Ceramic White',
    color: '#f2f0e8',
    metalness: 0.00,
    roughness: 0.60,
    clearcoat: 0.30,
    clearcoatRoughness: 0.20,
    envMapIntensity: 0.4,
  },
  {
    id: 'carbon-fiber',
    label: 'Carbon Fiber',
    color: '#2d2d2d',
    metalness: 0.10,
    roughness: 0.50,
    clearcoat: 0.30,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.5,
  },
  {
    id: 'prototype-blue',
    label: 'Prototype Blue',
    color: '#4a7dcc',
    metalness: 0.30,
    roughness: 0.35,
    clearcoat: 0.20,
    clearcoatRoughness: 0.30,
    envMapIntensity: 0.8,
  },
  {
    id: 'engineering-orange',
    label: 'Engineering Orange',
    color: '#cc6a2b',
    metalness: 0.20,
    roughness: 0.40,
    clearcoat: 0.15,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.7,
  },
  {
    id: 'prototype-rose',
    label: 'Prototype Rose',
    color: '#d4818c',
    metalness: 0.20,
    roughness: 0.35,
    clearcoat: 0.25,
    clearcoatRoughness: 0.30,
    envMapIntensity: 0.7,
  },
  {
    id: 'rose-titanium',
    label: 'Rose Titanium',
    color: '#b895a0',
    metalness: 0.65,
    roughness: 0.20,
    clearcoat: 0.10,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.0,
  },
  {
    id: 'engineering-lavender',
    label: 'Engineering Lavender',
    color: '#9b8ec4',
    metalness: 0.15,
    roughness: 0.40,
    clearcoat: 0.20,
    clearcoatRoughness: 0.30,
    envMapIntensity: 0.6,
  },
  {
    id: 'emerald-prototype',
    label: 'Emerald Prototype',
    color: '#5f9e8a',
    metalness: 0.25,
    roughness: 0.35,
    clearcoat: 0.20,
    clearcoatRoughness: 0.30,
    envMapIntensity: 0.7,
  },
  {
    id: 'safety-yellow',
    label: 'Safety Yellow',
    color: '#e8c84a',
    metalness: 0.10,
    roughness: 0.45,
    clearcoat: 0.15,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.5,
  },
];

export function getCADMaterialPreset(id: string): CADMaterialPreset {
  return CAD_MATERIALS.find(m => m.id === id) ?? CAD_MATERIALS[0];
}

export function createCADMaterial(preset: CADMaterialPreset): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(preset.color),
    metalness: preset.metalness,
    roughness: preset.roughness,
    clearcoat: preset.clearcoat,
    clearcoatRoughness: preset.clearcoatRoughness,
    envMapIntensity: preset.envMapIntensity,
    ior: preset.ior ?? 1.5,
    reflectivity: preset.ior ? 0.5 : 0.3,
    side: THREE.DoubleSide,
  });
}
