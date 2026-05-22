export type Severity = 'info' | 'warning' | 'critical';

export type LegacyPrintabilityStatus = 'good' | 'warning' | 'critical';

export type FindingCategory =
  | 'wall_thickness'
  | 'overhang'
  | 'watertightness'
  | 'scale'
  | 'orientation'
  | 'material'
  | 'slicer'
  | 'unknown';

export type FindingSource = 'heuristic' | 'mesh_analysis' | 'slicer' | 'advisor';

export interface PrintabilityFinding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  message: string;
  source: FindingSource;
  metrics?: Record<string, number | string | boolean>;
}
