# Quote Template (Global EN)

> Fill from the analysis report. Three fixed blocks: material + machine time + failure cover (one free remake, priced in advance).

## 1. Basis

- Model: {fileName} ({triangles} tris)
- Size: {x} × {y} × {z} mm / Volume: {volume} (if open shell: "volume TBD — re-quote after repair")
- Process: {process} / Material: {material} / Layer: {layerHeight} / Infill: {infill}

## 2. Breakdown

| Item | Qty | Rate | Amount |
|------|-----|------|--------|
| Material ({material}, incl. support) | {weight}g | ${pricePerKg}/kg | ${materialCost} |
| Machine time (incl. setup) | {hours}h | ${machineRate}/h | ${machineCost} |
| Post-processing (support removal, sanding) | lot | — | ${postCost} |
| Failure cover (one remake, capped) | 1 | — | ${riskCost} |
| **Total (excl. tax)** | | | **${total}** |

## 3. Terms

- Delivery: {deliveryDate} (excludes repair waiting time)
- Deliverables: part + CLIENT SUMMARY report + dimension photos
- Warranty: one free remake within 7 days for print defects
- Excluded: design changes, un-simulated thermal/FEA, machine calibration drift

## 4. Honest line (when risk is high)

> Print-failure risk is high as-is. Cheapest next step: "{cheapestStep}".
> Formal quote follows the re-exported report.
