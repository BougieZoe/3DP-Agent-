/**
 * OrderCard — 3D Print Order Summary
 *
 * Shows STL preview, specs, pricing, and status.
 * Designed for quick scanning at a glance.
 */

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { parseSTL } from '@/lib/stlParser';
import type { Order } from '@shared/domain/order';
import { STATUS_COLORS, SHIPPING_TERMS } from '@shared/domain/order';

interface OrderCardProps {
  order: Order;
  language: 'en' | 'ja' | 'zh';
  onSelect?: (orderId: string) => void;
  onDelete?: (orderId: string) => void;
  compact?: boolean;
}

const L = {
  en: {
    material: 'Material', qty: 'Qty', total: 'Total',
    dims: 'Dims', weight: 'Weight', shipping: 'Shipping',
    eta: 'ETA', view: 'View Details',
  },
  ja: {
    material: '材料', qty: '数量', total: '合計',
    dims: '寸法', weight: '重量', shipping: '配送',
    eta: '納期', view: '詳細を見る',
  },
  zh: {
    material: '材料', qty: '数量', total: '合计',
    dims: '尺寸', weight: '重量', shipping: '物流',
    eta: '预计到货', view: '查看详情',
  },
};

export function OrderCard({ order, language, onSelect, onDelete, compact = false }: OrderCardProps) {
  const t = L[language] || L.en;

  const specs = useMemo(() => {
    const d = order.specs.dimensions;
    return {
      dims: `${d.x.toFixed(1)} × ${d.y.toFixed(1)} × ${d.z.toFixed(1)}`,
      weight: order.specs.weightGrams.toFixed(0),
      volume: order.specs.volumeMm3.toFixed(0),
    };
  }, [order]);

  const statusColor = STATUS_COLORS[order.status];
  const shippingLabel = SHIPPING_TERMS[order.shipping.terms]?.[language] || order.shipping.terms;

  return (
    <div
      className="border border-border/50 rounded-lg bg-card/30 p-3 hover:bg-card/50 transition-colors cursor-pointer group"
      onClick={() => onSelect?.(order.id)}
    >
      {/* Header: Status + Price */}
      <div className="flex items-start justify-between mb-2">
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${statusColor}`}>
          {order.status.toUpperCase()}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-lg font-mono font-bold text-primary">
            ${order.price.total.toFixed(2)}
          </span>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(order.id); }}
              className="text-muted-foreground/20 hover:text-red-400 transition-colors text-xs"
              title="Delete"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* STL Preview */}
      <div className="h-24 rounded bg-muted/20 mb-2 overflow-hidden relative">
        {order.stlPreviewUrl ? (
          <img src={order.stlPreviewUrl} alt={order.stlFileName} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 text-xs font-mono">
            {order.stlFileName}
          </div>
        )}
      </div>

      {/* Specs Grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
        <div className="flex justify-between">
          <span className="text-muted-foreground/50">{t.material}</span>
          <span className="text-foreground/70">{order.material}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground/50">{t.qty}</span>
          <span className="text-foreground/70">{order.quantity}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground/50">{t.dims}</span>
          <span className="text-foreground/70">{specs.dims} mm</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground/50">{t.weight}</span>
          <span className="text-foreground/70">{specs.weight}g</span>
        </div>
      </div>

      {/* Price Breakdown */}
      {!compact && (
        <div className="mt-2 pt-2 border-t border-border/20">
          <div className="h-1 flex gap-0.5 mb-1.5">
            <div className="bg-cyan-400 rounded-full" style={{ width: `${(order.price.material / order.price.total) * 100}%` }} />
            <div className="bg-amber-400 rounded-full" style={{ width: `${(order.price.machine / order.price.total) * 100}%` }} />
            <div className="bg-emerald-400 rounded-full" style={{ width: `${((order.price.labor + order.price.margin) / order.price.total) * 100}%` }} />
            <div className="bg-purple-400 rounded-full" style={{ width: `${(order.price.shipping / order.price.total) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-muted-foreground/40">
            <span>mat ${order.price.material.toFixed(2)}</span>
            <span>mach ${order.price.machine.toFixed(2)}</span>
            <span>ship ${order.price.shipping.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Shipping */}
      <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-muted-foreground/40">
        <span>{shippingLabel} · {order.shipping.carrier || '—'}</span>
        <span>{t.eta}: {order.shipping.eta}</span>
      </div>

      {/* View button */}
      <div className="mt-2 text-center">
        <span className="text-[10px] font-mono text-primary/60 group-hover:text-primary transition-colors">
          {t.view} →
        </span>
      </div>
    </div>
  );
}
