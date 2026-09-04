/**
 * VendorCapacity — Read-only adapter layer for machine availability
 * and material stock. Queried at two decision points only (Process &
 * Material Selection, RFQ generation), NOT inside the DfAM iterate loop.
 *
 * Data source is a local JSON file (manually sourced, not a live API).
 */

// ── Types ──

export interface MachineAvailability {
  machineId: string;
  status: 'available' | 'booked' | 'maintenance';
  nextFreeSlot?: string; // ISO date — present if status === 'booked'
}

export interface MaterialStock {
  materialType: string;
  remainingKg: number;
  lastUpdated: string; // ISO date — required, never optional
}

export interface VendorCapacityAdapter {
  getMachineAvailability(machineId: string): Promise<MachineAvailability | null>;
  getMaterialStock(materialType: string): Promise<MaterialStock | null>;
}

// ── Staleness threshold (named constant, not magic number) ──

export const CAPACITY_STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── JSON file adapter ──

interface VendorCapacityFile {
  machines: MachineAvailability[];
  materials: MaterialStock[];
}

export class JsonVendorCapacityAdapter implements VendorCapacityAdapter {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getMachineAvailability(machineId: string): Promise<MachineAvailability | null> {
    const data = await this.readFile();
    if (!data) return null;
    const match = data.machines.find((m) => m.machineId === machineId);
    return match ?? null;
  }

  async getMaterialStock(materialType: string): Promise<MaterialStock | null> {
    const data = await this.readFile();
    if (!data) return null;
    const match = data.materials.find(
      (m) => m.materialType.toUpperCase() === materialType.toUpperCase(),
    );
    return match ?? null;
  }

  private async readFile(): Promise<VendorCapacityFile | null> {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as VendorCapacityFile;
    } catch (err) {
      console.warn(`[vendorCapacity] Failed to read ${this.filePath}: ${String(err)}`);
      return null;
    }
  }
}

// ── Helpers ──

export function isCapacityStale(lastUpdated: string, now: Date = new Date()): boolean {
  const age = now.getTime() - new Date(lastUpdated).getTime();
  return age > CAPACITY_STALENESS_THRESHOLD_MS;
}
