import { useMemo, useState } from 'react';

interface PrintQuoteProps {
  volumeMm3: number;
  infillPercent: number;
  hasOverhang: boolean;
}

const MATERIALS = [
  { id: 'pla', label: 'PLA', density: 0.00124, pricePerG: 0.08 },
  { id: 'resin', label: 'Resin', density: 0.00112, pricePerG: 0.18 },
  { id: 'abs', label: 'ABS', density: 0.00105, pricePerG: 0.10 },
];

export function PrintQuote({ volumeMm3, infillPercent, hasOverhang }: PrintQuoteProps) {
  const [material, setMaterial] = useState('pla');
  const mat = MATERIALS.find(m => m.id === material)!;

  const estimate = useMemo(() => {
    const fillRatio = infillPercent / 100;
    const weightG = volumeMm3 * mat.density * (0.3 + 0.7 * fillRatio);
    const supportExtra = hasOverhang ? weightG * 0.15 : 0;
    const totalWeight = weightG + supportExtra;
    const printCost = totalWeight * mat.pricePerG;
    const shippingLow = totalWeight < 100 ? 18 : totalWeight < 500 ? 35 : 55;
    const shippingHigh = shippingLow * 1.4;
    return {
      weightG: totalWeight.toFixed(1),
      printLow: (printCost * 0.85).toFixed(2),
      printHigh: (printCost * 1.2).toFixed(2),
      shippingLow: shippingLow.toFixed(0),
      shippingHigh: shippingHigh.toFixed(0),
      totalLow: (printCost * 0.85 + shippingLow).toFixed(2),
      totalHigh: (printCost * 1.2 + shippingHigh).toFixed(2),
    };
  }, [volumeMm3, infillPercent, mat, hasOverhang]);

  return (
    <div className="border border-border rounded-sm bg-card p-4 space-y-3">
      <div className="text-xs font-mono text-primary tracking-widest">// PRINT QUOTE</div>
      <div className="flex gap-1">
        {MATERIALS.map(m => (
          <button key={m.id} onClick={() => setMaterial(m.id)}
            className={`text-xs font-mono px-3 py-1 border rounded-sm transition-all ${
              material === m.id ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-primary'
            }`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs font-mono">
          <span className="text-muted-foreground">Est. Weight</span>
          <span className="text-foreground">{estimate.weightG} g</span>
        </div>
        <div className="flex justify-between text-xs font-mono">
          <span className="text-muted-foreground">Print Cost</span>
          <span className="text-primary">${estimate.printLow} – ${estimate.printHigh}</span>
        </div>
        <div className="flex justify-between text-xs font-mono">
          <span className="text-muted-foreground">Shipping (CN→US)</span>
          <span className="text-foreground">${estimate.shippingLow} – ${estimate.shippingHigh}</span>
        </div>
        <div className="border-t border-border/40 pt-2 flex justify-between text-xs font-mono">
          <span className="text-muted-foreground">Total Est.</span>
          <span className="text-primary font-bold">${estimate.totalLow} – ${estimate.totalHigh}</span>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground/40 font-mono">
        * Estimate only. Actual price depends on complexity, finishing, and supplier.
      </div>
    </div>
  );
}
