/**
 * AutoQuote — Automatic price quotation engine
 *
 * Generates quotes based on model analysis + supplier price list.
 * Handles material cost, machine time, labor, and shipping estimates.
 */

import type { Order, PriceBreakdown, SupplierPriceList } from '@shared/domain/order';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';

interface QuoteParams {
  analysis: UnifiedAnalysis;
  material: Material;
  quantity: number;
  supplierPrices: SupplierPriceList[];
  destination?: string;
  shippingTerms?: 'EXW' | 'FOB' | 'CIF' | 'DDP';
}

interface QuoteResult {
  price: PriceBreakdown;
  leadTimeDays: number;
  supplierId: string;
  confidence: number;
  notes: string[];
}

// Labor cost estimates by technology ($/hour)
const LABOR_RATES: Record<string, number> = {
  fdm: 10,
  sla: 12,
  sls: 18,
  slm: 25,
  mjf: 20,
  fgf: 15,
  default: 12,
};

// Margin multipliers by quantity
function getMarginMultiplier(quantity: number): number {
  if (quantity >= 100) return 1.10;  // 10% margin
  if (quantity >= 50) return 1.15;
  if (quantity >= 10) return 1.20;
  if (quantity >= 5) return 1.25;
  return 1.30;  // Small batch = higher margin
}

export function generateQuote(params: QuoteParams): QuoteResult | null {
  const { analysis, material, quantity, supplierPrices, shippingTerms = 'DDP' } = params;

  const metrics = analysis.metrics?.result;
  const pt = analysis.printTime?.result;
  if (!metrics || !pt || metrics.meshVolumeMm3 <= 0) return null;

  // Find best matching supplier price
  const supplierPrice = supplierPrices.find(
    sp => sp.material.toUpperCase() === material.name.toUpperCase() &&
          sp.technology.toUpperCase() === material.technology.toUpperCase()
  );

  if (!supplierPrice) return null;

  // Calculate costs
  const weightKg = pt.materialWeightGrams / 1000;
  const printHours = pt.estimatedPrintTimeHours;

  // Material cost from supplier price list
  const materialCost = weightKg * supplierPrice.pricePerKg;

  // Machine cost from supplier price list
  const machineCost = printHours * supplierPrice.machineRatePerHour;

  // Labor cost (setup, monitoring, post-processing)
  const laborRate = LABOR_RATES[material.technology] || LABOR_RATES.default;
  const setupTime = 0.5;  // 30 min setup
  const postProcessTime = quantity > 10 ? 0.2 * quantity : quantity * 0.5;
  const laborCost = (setupTime + postProcessTime / 60) * laborRate;

  // Shipping cost estimate
  const shippingCostPerKg = (supplierPrice.shippingRates as any)?.[shippingTerms] || 8;
  const shippingCost = weightKg * shippingCostPerKg * quantity;

  // Subtotal before margin
  const subtotal = materialCost + machineCost + laborCost + shippingCost;

  // Apply margin
  const marginMultiplier = getMarginMultiplier(quantity);
  const total = subtotal * marginMultiplier;
  const margin = total - subtotal;

  // Lead time estimate
  const baseLeadTime = supplierPrice.leadTimeDays;
  const quantityFactor = Math.ceil(quantity / 10);
  const leadTimeDays = baseLeadTime + quantityFactor;

  // Confidence score
  let confidence = 0.8;
  if (pt.source === 'slicer') confidence += 0.15;
  if (supplierPrice) confidence += 0.05;
  confidence = Math.min(1, confidence);

  const notes: string[] = [];
  if (quantity > 50) notes.push('Large batch discount may apply');
  if (printHours > 24) notes.push('Long print time - consider splitting');
  if (metrics.overhang.ratio > 0.3) notes.push('High support requirement');

  return {
    price: {
      material: parseFloat(materialCost.toFixed(2)),
      machine: parseFloat(machineCost.toFixed(2)),
      labor: parseFloat(laborCost.toFixed(2)),
      shipping: parseFloat(shippingCost.toFixed(2)),
      margin: parseFloat(margin.toFixed(2)),
      total: parseFloat(total.toFixed(2)),
      currency: 'USD',
    },
    leadTimeDays,
    supplierId: supplierPrice.supplierId,
    confidence,
    notes,
  };
}

export function formatQuoteForDisplay(quote: QuoteResult, language: 'en' | 'ja' | 'zh' = 'en'): string {
  const { price, leadTimeDays, notes } = quote;

  const lines = {
    en: [
      `Material: $${price.material.toFixed(2)}`,
      `Machine: $${price.machine.toFixed(2)}`,
      `Labor: $${price.labor.toFixed(2)}`,
      `Shipping: $${price.shipping.toFixed(2)}`,
      `Margin: $${price.margin.toFixed(2)}`,
      `───`,
      `Total: $${price.total.toFixed(2)}`,
      `Lead time: ${leadTimeDays} days`,
    ],
    ja: [
      `材料: $${price.material.toFixed(2)}`,
      `機械: $${price.machine.toFixed(2)}`,
      `労務: $${price.labor.toFixed(2)}`,
      `配送: $${price.shipping.toFixed(2)}`,
      `利益: $${price.margin.toFixed(2)}`,
      `───`,
      `合計: $${price.total.toFixed(2)}`,
      `納期: ${leadTimeDays}日`,
    ],
    zh: [
      `材料: $${price.material.toFixed(2)}`,
      `机器: $${price.machine.toFixed(2)}`,
      `人工: $${price.labor.toFixed(2)}`,
      `物流: $${price.shipping.toFixed(2)}`,
      `利润: $${price.margin.toFixed(2)}`,
      `───`,
      `合计: $${price.total.toFixed(2)}`,
      `交期: ${leadTimeDays}天`,
    ],
  };

  const result = lines[language] || lines.en;
  if (notes.length > 0) {
    result.push(`\nNotes: ${notes.join(', ')}`);
  }
  return result.join('\n');
}
