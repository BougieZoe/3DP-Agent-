export interface ManufacturingPartner {
  partnerId: string;
  processTypes: string[];
  buildSize: { widthMm: number; depthMm: number; heightMm: number };
  maxOutputKgH: number;
  nozzleRangeMm: [number, number];
  priceRange: string;
  leadTimeDays: number | null;
}

export const PARTNER_ROSTER: Record<string, ManufacturingPartner> = {
  "partner-001": {
    partnerId: "partner-001",
    processTypes: ["FGF"],
    buildSize: { widthMm: 1800, depthMm: 1200, heightMm: 1300 },
    maxOutputKgH: 15,
    nozzleRangeMm: [1, 8],
    priceRange: "unknown",
    leadTimeDays: null,
  },
} as const;

export type PartnerId = keyof typeof PARTNER_ROSTER;
