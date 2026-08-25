/**
 * OrderListView — List and filter orders
 *
 * Shows all orders with status filters and quick actions.
 */

import { useState, Suspense } from 'react';
import { OrderCard } from './OrderCard';
import type { Order, OrderStatus } from '@shared/domain/order';
import { ORDER_STATUS_FLOW, STATUS_COLORS } from '@shared/domain/order';

interface OrderListViewProps {
  orders: Order[];
  language: 'en' | 'ja' | 'zh';
  onSelectOrder?: (orderId: string) => void;
  onUpdateStatus?: (orderId: string, status: OrderStatus) => void;
}

const L = {
  en: { title: 'ORDERS', all: 'All', empty: 'No orders yet.', next: 'Next →' },
  ja: { title: '注文一覧', all: 'すべて', empty: '注文なし。', next: '次へ →' },
  zh: { title: '订单列表', all: '全部', empty: '暂无订单。', next: '下一步 →' },
};

const STATUS_LABELS: Record<OrderStatus, Record<string, string>> = {
  draft: { en: 'Draft', ja: '下書き', zh: '草稿' },
  quoted: { en: 'Quoted', ja: '見積済', zh: '已报价' },
  accepted: { en: 'Accepted', ja: '承認済', zh: '已接受' },
  paid: { en: 'Paid', ja: '支払済', zh: '已付款' },
  printing: { en: 'Printing', ja: '印刷中', zh: '打印中' },
  shipped: { en: 'Shipped', ja: '発送済', zh: '已发货' },
  delivered: { en: 'Delivered', ja: '配達済', zh: '已送达' },
  cancelled: { en: 'Cancelled', ja: 'キャンセル', zh: '已取消' },
};

export function OrderListView({ orders, language, onSelectOrder, onUpdateStatus }: OrderListViewProps) {
  const t = L[language] || L.en;
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);

  const counts = {
    all: orders.length,
    ...ORDER_STATUS_FLOW.reduce((acc, status) => {
      acc[status] = orders.filter(o => o.status === status).length;
      return acc;
    }, {} as Record<OrderStatus, number>),
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{t.title}</span>
        <span className="text-[10px] font-mono text-muted-foreground/40">{orders.length}</span>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setFilter('all')}
          className={`px-2 py-0.5 text-[9px] font-mono rounded-full transition-colors ${
            filter === 'all'
              ? 'bg-primary/20 text-primary'
              : 'bg-muted/20 text-muted-foreground/40 hover:text-muted-foreground/60'
          }`}
        >
          {t.all} ({counts.all})
        </button>
        {ORDER_STATUS_FLOW.map(status => (
          counts[status] > 0 && (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-2 py-0.5 text-[9px] font-mono rounded-full transition-colors ${
                filter === status
                  ? STATUS_COLORS[status]
                  : 'bg-muted/20 text-muted-foreground/40 hover:text-muted-foreground/60'
              }`}
            >
              {STATUS_LABELS[status][language]} ({counts[status]})
            </button>
          )
        ))}
      </div>

      {/* Order list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-xs font-mono text-muted-foreground/30">
          {t.empty}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(order => (
            <div key={order.id} className="relative">
              <OrderCard
                order={order}
                language={language}
                onSelect={onSelectOrder}
              />
              {/* Status advance button */}
              {order.status !== 'delivered' && order.status !== 'cancelled' && onUpdateStatus && (
                <div className="absolute bottom-3 right-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.indexOf(order.status) + 1];
                      if (next) onUpdateStatus(order.id, next);
                    }}
                    className="px-2 py-0.5 text-[8px] font-mono bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
                  >
                    {t.next}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
