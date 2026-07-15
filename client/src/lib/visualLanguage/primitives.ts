import * as THREE from 'three';

export const OPACITIES = {
  overlay:        0.30,
  overlayMax:     0.35,
  atmospheric:    0.15,
  atmosphericMax: 0.20,
  pulsePeak:      0.40,
  pulsePeakMax:   0.45,
  ghost:          0.12,
  scanPlane:      0.12,
  line:           0.25,
  dimLine:        0.15,
  highlightPt:    0.35,
  failureOverlay: 0.22,
  stressOverlay:  0.18,
  thermalShows:   0.20,
  marker:         0.25,
  ghostMarker:    0.08,
  printHeadLine:  0.375,
} as const;

export const SIZES = {
  sphereSeg:     16,
  sphereSegLow:  8,
  sphereSegMin:  6,
  point:         0.08,
  pointSmall:    0.04,
  head:          0.06,
  ghostSphere:   0.4,
  pulseRadius:   0.5,
  stressRadius:  0.08,
  oscRadius:     0.04,
  scanPlane:     10,
  markerSphere:  0.3,
  sagLineInit:   0.01,
  initialScale:  0.01,
} as const;

export const MATERIALS = {
  additive: {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  additiveDouble: {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  },
  line: {
    transparent: true,
    depthWrite: false,
  },
  points: {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  },
} as const;

export const GLOW = { low: 0.08, mid: 0.18, high: 0.35 } as const;
