/**
 * Order — 3D Printing Order Data Model
 *
 * Represents a complete order from quote to delivery.
 * Includes STL preview, specs, pricing, and logistics.
 */

export type OrderStatus = 'draft' | 'quoted' | 'accepted' | 'paid' | 'printing' | 'shipped' | 'delivered' | 'cancelled';
export type ShippingTerms = 'EXW' | 'FOB' | 'CIF' | 'DDP';
export type UserRole = 'designer' | 'supplier' | 'customer';

export interface OrderSpecs {
  dimensions: { x: number; y: number; z: number };
  volumeMm3: number;
  surfaceAreaMm2: number;
  weightGrams: number;
}

export interface PriceBreakdown {
  material: number;
  machine: number;
  labor: number;
  shipping: number;
  margin: number;
  total: number;
  currency: string;
}

export interface ShippingInfo {
  terms: ShippingTerms;
  origin: string;
  destination: string;
  carrier: string;
  trackingNumber?: string;
  eta: string;
  cost: number;
}

export interface Order {
  id: string;
  createdAt: string;
  updatedAt: string;

  // Parties
  designerId?: string;
  supplierId: string;
  customerId: string;

  // Product
  stlFileName: string;
  stlPreviewUrl?: string;  // Thumbnail URL or base64
  specs: OrderSpecs;
  material: string;
  technology: string;
  quantity: number;
  color?: string;

  // Pricing
  price: PriceBreakdown;

  // Logistics
  shipping: ShippingInfo;

  // Status
  status: OrderStatus;
  notes?: string;
  messages?: OrderMessage[];
}

export interface OrderMessage {
  id: string;
  senderId: string;
  senderRole: UserRole;
  content: string;
  timestamp: string;
  attachments?: string[];
}

export interface SupplierPriceList {
  supplierId: string;
  material: string;
  technology: string;
  pricePerKg: number;
  machineRatePerHour: number;
  minOrderQuantity: number;
  leadTimeDays: number;
  shippingRates: Record<ShippingTerms, number>;
}

// Status flow
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'draft', 'quoted', 'accepted', 'paid', 'printing', 'shipped', 'delivered'
];

// Status colors
export const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'text-muted-foreground bg-muted/20',
  quoted: 'text-cyan-400 bg-cyan-400/10',
  accepted: 'text-amber-400 bg-amber-400/10',
  paid: 'text-emerald-400 bg-emerald-400/10',
  printing: 'text-blue-400 bg-blue-400/10',
  shipped: 'text-purple-400 bg-purple-400/10',
  delivered: 'text-emerald-400 bg-emerald-400/10',
  cancelled: 'text-red-400 bg-red-400/10',
};

// Shipping terms labels
export const SHIPPING_TERMS: Record<ShippingTerms, { en: string; zh: string; ja: string }> = {
  EXW: { en: 'Ex Works', zh: '工厂交货', ja: '工場渡し' },
  FOB: { en: 'Free on Board', zh: '船上交货', ja: '本船渡し' },
  CIF: { en: 'Cost, Insurance & Freight', zh: '到岸价', ja: 'CIF' },
  DDP: { en: 'Delivered Duty Paid', zh: '完税后交货', ja: '関税込持込渡し' },
};
