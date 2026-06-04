import { useMemo, useState } from 'react';
import { PANEL } from '@/lib/visualLanguage';

// ── Types ──────────────────────────────────────────────────
interface PrintQuoteProps {
  volumeMm3: number;
  infillPercent: number;
  hasOverhang: boolean;
}

interface Material {
  id: string;
  label: string;
  density: number;
  pricePerG: number;
}

interface QuoteEstimate {
  weightG: string;
  printLow: string;
  printHigh: string;
  shippingLow: string;
  shippingHigh: string;
  totalLow: string;
  totalHigh: string;
}

// ── Constants ─────────────────────────────────────────────
const MATERIALS: Material[] = [
  { id: 'pla',   label: 'PLA',   density: 0.00124, pricePerG: 0.08 },
  { id: 'resin', label: 'Resin', density: 0.00112, pricePerG: 0.18 },
  { id: 'abs',   label: 'ABS',   density: 0.00105, pricePerG: 0.10 },
];

// ── Pure calculation ──────────────────────────────────────
function calcEstimate(
  volumeMm3: number,
  infillPercent: number,
  hasOverhang: boolean,
  mat: Material,
): QuoteEstimate {
  const fillRatio    = infillPercent / 100;
  const baseWeight   = volumeMm3 * mat.density * (0.3 + 0.7 * fillRatio);
  const totalWeight  = baseWeight + (hasOverhang ? baseWeight * 0.15 : 0);
  const printCost    = totalWeight * mat.pricePerG;
  const shippingLow  = totalWeight < 100 ? 18 : totalWeight < 500 ? 35 : 55;
  const shippingHigh = shippingLow * 1.4;
  return {
    weightG:     totalWeight.toFixed(1),
    printLow:    (printCost * 0.85).toFixed(2),
    printHigh:   (printCost * 1.20).toFixed(2),
    shippingLow: shippingLow.toFixed(0),
    shippingHigh:shippingHigh.toFixed(0),
    totalLow:    (printCost * 0.85 + shippingLow).toFixed(2),
    totalHigh:   (printCost * 1.20 + shippingHigh).toFixed(2),
  };
}

// ── Sub-components ────────────────────────────────────────
function MaterialTab({ mat, active, onSelect }: {
  mat: Material; active: boolean; onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(mat.id)}
      className={[
        PANEL.fontButton, PANEL.rounded, PANEL.border, 'px-3 py-1 transition-all',
        active
          ? 'border-primary text-primary bg-primary/10'
          : `${PANEL.borderHover} text-muted-foreground hover:text-primary`,
      ].join(' ')}
    >
      {mat.label}
    </button>
  );
}

function QuoteRow({ label, value, accent = false }: {
  label: string; value: string; accent?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className={PANEL.fontMetric + ' text-muted-foreground'}>{label}</span>
      <span className={PANEL.fontMetric + (accent ? ' text-primary font-bold' : ' text-foreground')}>
        {value}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────
export function PrintQuote({ volumeMm3, infillPercent, hasOverhang }: PrintQuoteProps) {
  const [materialId, setMaterialId] = useState<string>('pla');

  const mat = MATERIALS.find(m => m.id === materialId) ?? MATERIALS[0];

  const estimate = useMemo(
    () => calcEstimate(volumeMm3, infillPercent, hasOverhang, mat),
    [volumeMm3, infillPercent, hasOverhang, mat],
  );

  return (
    <div className={[PANEL.bg, PANEL.glass, PANEL.border, PANEL.rounded, PANEL.paddingCard, PANEL.gapSection, 'flex flex-col'].join(' ')}>
      <div className={PANEL.fontLabel}>// PRINT QUOTE</div>

      <div className="flex gap-1">
        {MATERIALS.map(m => (
          <MaterialTab key={m.id} mat={m} active={m.id === materialId} onSelect={setMaterialId} />
        ))}
      </div>

      <div className={PANEL.gapItems}>
        <QuoteRow label="Est. Weight"       value={`${estimate.weightG} g`} />
        <QuoteRow label="Print Cost"        value={`$${estimate.printLow} – $${estimate.printHigh}`} accent />
        <QuoteRow label="Shipping (CN→US)"  value={`$${estimate.shippingLow} – $${estimate.shippingHigh}`} />
        <div className={PANEL.separator} />
        <QuoteRow label="Total Est."        value={`$${estimate.totalLow} – $${estimate.totalHigh}`} accent />
      </div>

      <button className={[PANEL.fontButton, PANEL.rounded, PANEL.border, 'w-full py-2 border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-all'].join(' ')}>
        GET QUOTES FROM FACTORIES →
      </button>

      <div className={PANEL.fontTiny + ' text-muted-foreground/40'}>
        * Estimate only. Actual price depends on complexity, finishing, and supplier.
      </div>
    </div>
  );
}
