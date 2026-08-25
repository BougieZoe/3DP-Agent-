/**
 * PriceListImporter — Import supplier price lists from CSV
 *
 * Parses CSV files with material pricing data.
 * Supports common formats from Excel/Google Sheets.
 */

import type { SupplierPriceList } from '@shared/domain/order';

interface ParseResult {
  data: SupplierPriceList[];
  errors: string[];
  warnings: string[];
}

const COLUMN_ALIASES: Record<string, keyof SupplierPriceList> = {
  'material': 'material',
  'materialname': 'material',
  '材料': 'material',
  '材料名': 'material',
  'technology': 'technology',
  'tech': 'technology',
  '工艺': 'technology',
  '技術': 'technology',
  'priceperkg': 'pricePerKg',
  'price_kg': 'pricePerKg',
  '价格/kg': 'pricePerKg',
  '単価': 'pricePerKg',
  'machinerateperhour': 'machineRatePerHour',
  'hourlyrate': 'machineRatePerHour',
  'machine_hourly': 'machineRatePerHour',
  '机器时费': 'machineRatePerHour',
  '時間単価': 'machineRatePerHour',
  'minorderquantity': 'minOrderQuantity',
  'moq': 'minOrderQuantity',
  '最小订单': 'minOrderQuantity',
  '最低注文': 'minOrderQuantity',
  'leadtimedays': 'leadTimeDays',
  'leadtime': 'leadTimeDays',
  'lead_time': 'leadTimeDays',
  '交期': 'leadTimeDays',
  '納期': 'leadTimeDays',
  'shippingddp': 'shippingDDP',
  'ddp': 'shippingDDP',
  'ddp_rate': 'shippingDDP',
  '到门价': 'shippingDDP',
  '持込渡し': 'shippingDDP',
};

function normalizeColumnName(name: string): keyof SupplierPriceList | null {
  const normalized = name.toLowerCase().replace(/[\s_-]/g, '');
  return COLUMN_ALIASES[normalized] || COLUMN_ALIASES[name.toLowerCase()] || null;
}

function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of row) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function parsePriceListCSV(csvContent: string, supplierId: string): ParseResult {
  const lines = csvContent.split('\n').filter(line => line.trim());
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: SupplierPriceList[] = [];

  if (lines.length < 2) {
    errors.push('CSV file is empty or has no data rows');
    return { data, errors, warnings };
  }

  // Parse header
  const headerLine = lines[0];
  const headers = parseCSVRow(headerLine);
  const columnMap: Map<number, keyof SupplierPriceList> = new Map();

  headers.forEach((header, index) => {
    const field = normalizeColumnName(header);
    if (field) {
      columnMap.set(index, field);
    }
  });

  // Validate required columns
  const hasMaterial = Array.from(columnMap.values()).includes('material');
  const hasPrice = Array.from(columnMap.values()).includes('pricePerKg');

  if (!hasMaterial) {
    errors.push('Missing required column: material');
  }
  if (!hasPrice) {
    errors.push('Missing required column: pricePerKg');
  }

  if (errors.length > 0) {
    return { data, errors, warnings };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

    const record: Partial<SupplierPriceList> = { supplierId };

    columnMap.forEach((field, colIndex) => {
      const value = row[colIndex];
      if (value === undefined || value === '') return;

      if (field === 'material' || field === 'technology') {
        (record as any)[field] = value.toUpperCase();
      } else if (field === 'shippingDDP') {
        // Store DDP rate in shippingRates
        if (!record.shippingRates) record.shippingRates = {} as any;
        (record.shippingRates as any).DDP = parseFloat(value) || 0;
      } else {
        (record as any)[field] = parseFloat(value) || 0;
      }
    });

    // Validate row
    if (!record.material) {
      warnings.push(`Row ${i + 1}: Missing material name, skipping`);
      continue;
    }
    if (!record.pricePerKg || record.pricePerKg <= 0) {
      warnings.push(`Row ${i + 1}: Invalid price for ${record.material}, using 0`);
      record.pricePerKg = 0;
    }

    // Set defaults
    record.technology = record.technology || 'FDM';
    record.machineRatePerHour = record.machineRatePerHour || 15;
    record.minOrderQuantity = record.minOrderQuantity || 1;
    record.leadTimeDays = record.leadTimeDays || 7;
    if (!record.shippingRates) {
      record.shippingRates = {} as any;
      (record.shippingRates as any).DDP = 0;
    }

    data.push(record as SupplierPriceList);
  }

  if (data.length === 0) {
    warnings.push('No valid price data found in CSV');
  }

  return { data, errors, warnings };
}

export function generateSampleCSV(): string {
  return `Material,Technology,Price/kg ($),Machine Rate ($/hr),MOQ (kg),Lead Time (days),DDP Rate ($/kg)
PLA,FDM,22,15,1,3,8
PETG,FDM,25,15,1,3,9
ABS,FDM,18,15,1,3,8
ASA,FDM,28,18,1,4,10
TPU,FDM,35,20,2,5,12
Nylon,FDM,45,25,2,5,15
PLA,SLA,40,12,0.5,2,10
Standard Resin,SLA,35,12,0.5,2,10
`;
}
