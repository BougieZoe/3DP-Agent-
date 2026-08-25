/**
 * OrderForm — Create New Order
 *
 * Form for creating a 3D print order from analysis results.
 * Auto-fills specs from uploaded model.
 */

import { useState } from 'react';
import type { Order, ShippingTerms } from '@shared/domain/order';
import { SHIPPING_TERMS } from '@shared/domain/order';
import type { UploadedModel } from '@/components/STLUploadHandler';
import type { Material } from '@shared/domain/material';
import { MATERIALS } from '@shared/domain/material';

interface OrderFormProps {
  model: UploadedModel;
  material: Material;
  onSubmit: (order: Partial<Order>) => void;
  onCancel: () => void;
  language: 'en' | 'ja' | 'zh';
}

const L = {
  en: {
    title: 'NEW ORDER',
    quantity: 'Quantity',
    color: 'Color',
    shippingTerms: 'Shipping Terms',
    origin: 'Ship From',
    destination: 'Ship To',
    notes: 'Notes',
    submit: 'Create Order',
    cancel: 'Cancel',
    material: 'Material',
    technology: 'Technology',
    estimatedCost: 'Estimated Cost',
  },
  ja: {
    title: '新規注文',
    quantity: '数量',
    color: 'カラー',
    shippingTerms: '配送条件',
    origin: '発送元',
    destination: '届け先',
    notes: '備考',
    submit: '注文作成',
    cancel: 'キャンセル',
    material: '材料',
    technology: '技術',
    estimatedCost: '推定コスト',
  },
  zh: {
    title: '新建订单',
    quantity: '数量',
    color: '颜色',
    shippingTerms: '贸易条款',
    origin: '发货地',
    destination: '收货地',
    notes: '备注',
    submit: '创建订单',
    cancel: '取消',
    material: '材料',
    technology: '工艺',
    estimatedCost: '预估成本',
  },
};

const COMMON_COLORS = ['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF6600', '#9933FF'];

export function OrderForm({ model, material, onSubmit, onCancel, language }: OrderFormProps) {
  const t = L[language] || L.en;

  const [quantity, setQuantity] = useState(1);
  const [color, setColor] = useState('#FFFFFF');
  const [shippingTerms, setShippingTerms] = useState<ShippingTerms>('DDP');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');

  const specs = model.unifiedAnalysis?.metrics?.result;
  const pt = model.unifiedAnalysis?.printTime?.result;

  const estimatedTotal = pt?.totalCostUsd ?? 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const order: Partial<Order> = {
      stlFileName: model.fileName,
      specs: specs ? {
        dimensions: specs.boundingBoxDimensionsMm,
        volumeMm3: specs.meshVolumeMm3,
        surfaceAreaMm2: specs.surfaceAreaMm2,
        weightGrams: pt?.materialWeightGrams ?? 0,
      } : undefined,
      material: material.name,
      technology: material.technology,
      quantity,
      color,
      price: {
        material: pt?.materialCostUsd ?? 0,
        machine: (pt?.totalCostUsd ?? 0) - (pt?.materialCostUsd ?? 0),
        labor: 0,
        shipping: 0,
        margin: 0,
        total: estimatedTotal * quantity,
        currency: 'USD',
      },
      shipping: {
        terms: shippingTerms,
        origin,
        destination,
        carrier: '',
        eta: '',
        cost: 0,
      },
      status: 'draft',
      notes,
    };

    onSubmit(order);
  };

  return (
    <form onSubmit={handleSubmit} className="border border-border/50 rounded-lg bg-card/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-primary tracking-widest">{t.title}</span>
        <span className="text-xs font-mono text-muted-foreground/40">{model.fileName}</span>
      </div>

      {/* Auto-filled specs */}
      <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
        <div>
          <label className="block text-muted-foreground/50 mb-1">{t.material}</label>
          <div className="text-foreground/70">{material.name} · {material.technology.toUpperCase()}</div>
        </div>
        <div>
          <label className="block text-muted-foreground/50 mb-1">{t.estimatedCost}</label>
          <div className="text-primary font-bold">${estimatedTotal.toFixed(2)} / part</div>
        </div>
      </div>

      {/* Quantity */}
      <div>
        <label className="block text-[10px] font-mono text-muted-foreground/50 mb-1">{t.quantity}</label>
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-full bg-muted/20 border border-border/30 rounded px-2 py-1.5 text-xs font-mono text-foreground"
        />
        {quantity > 1 && (
          <div className="text-[9px] font-mono text-muted-foreground/40 mt-1">
            Total: ${(estimatedTotal * quantity).toFixed(2)}
          </div>
        )}
      </div>

      {/* Color */}
      <div>
        <label className="block text-[10px] font-mono text-muted-foreground/50 mb-1">{t.color}</label>
        <div className="flex gap-1.5">
          {COMMON_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
                color === c ? 'border-primary scale-110' : 'border-border/30'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Shipping */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-mono text-muted-foreground/50 mb-1">{t.shippingTerms}</label>
          <select
            value={shippingTerms}
            onChange={e => setShippingTerms(e.target.value as ShippingTerms)}
            className="w-full bg-muted/20 border border-border/30 rounded px-2 py-1.5 text-xs font-mono text-foreground"
          >
            {Object.entries(SHIPPING_TERMS).map(([key, val]) => (
              <option key={key} value={key}>{key} — {val[language]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-mono text-muted-foreground/50 mb-1">{t.destination}</label>
          <input
            type="text"
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="e.g. Shenzhen, China"
            className="w-full bg-muted/20 border border-border/30 rounded px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/20"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[10px] font-mono text-muted-foreground/50 mb-1">{t.notes}</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full bg-muted/20 border border-border/30 rounded px-2 py-1.5 text-xs font-mono text-foreground resize-none placeholder:text-muted-foreground/20"
          placeholder="Special requirements..."
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 text-xs font-mono border border-border/30 rounded text-muted-foreground/60 hover:bg-muted/20 transition-colors"
        >
          {t.cancel}
        </button>
        <button
          type="submit"
          className="flex-1 px-3 py-1.5 text-xs font-mono bg-primary/20 border border-primary/30 rounded text-primary hover:bg-primary/30 transition-colors"
        >
          {t.submit}
        </button>
      </div>
    </form>
  );
}
