/**
 * On-device ML Models
 *
 * Barrel export for all ML inference models.
 */

export { predictWallThickness, loadWallThicknessModel, isWallThicknessModelLoaded, type WallThicknessResult } from './wallThickness';
export { detectOverhangs, loadOverhangModel, isOverhangModelLoaded, type OverhangResult } from './overhang';
export { generateSupports, loadSupportGenModel, isSupportGenModelLoaded, type SupportGenResult } from './supportGen';
export { predictPrintTime, loadPrintTimeModel, isPrintTimeModelLoaded, type PrintTimeResult } from './printTime';
