/**
 * OrderListView — List and filter orders
 *
 * Shows all orders with status filters, quick actions, and batch delete.
 */

import { useState } from 'react';
import { OrderCard } from './OrderCard';
import type { Order, OrderStatus } from '@shared/domain/order';
import { ORDER_STATUS_FLOW, STATUS_COLORS } from '@shared/domain/order';

interface OrderListViewProps {
  orders: Order[];
  language: 'en' | 'ja' | 'zh';
  onSelectOrder?: (orderId: string) => void;
  onUpdateStatus?: (orderId: string, status: OrderStatus) => void;
  onDeleteOrder?: (orderId: string) => void;
  onDeleteOrders?: (ids: string[]) => void;
}

const L = {
  en: {
    title: 'ORDERS', all: 'All', empty: 'No orders yet.', next: 'Next →',
    select: 'Select', deleteSelected: 'Delete', cancel: 'Cancel', selectAll: 'All',
    deleted: '{n} order(s) deleted',
  },
  ja: {
    title: '注文一覧', all: 'すべて', empty: '注文なし。', next: '次へ →',
    select: '選択', deleteSelected: '削除', cancel: 'キャンセル', selectAll: 'すべて',
    deleted: '{n}件の注文を削除しました',
  },
  zh: {
    title: '订单列表', all: '全部', empty: '暂无订单。', next: '下一步 →',
    select: '选择', deleteSelected: '删除', cancel: '取消', selectAll: '全选',
    deleted: '已删除 {n} 个订单',
  },
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

export function OrderListView({ orders, language, onSelectOrder, onUpdateStatus, onDeleteOrder, onDeleteOrders }: OrderListViewProps) {
  const t = L[language] || L.en;
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);

  const counts = {
    all: orders.length,
    ...ORDER_STATUS_FLOW.reduce((acc, status) => {
      acc[status] = orders.filter(o => o.status === status).length;
      return acc;
    }, {} as Record<OrderStatus, number>),
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(o => o.id)));
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (onDeleteOrders) {
      onDeleteOrders(Array.from(selectedIds));
    } else if (onDeleteOrder) {
      selectedIds.forEach(id => onDeleteOrder(id));
    }
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const cancelSelect = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{t.title}</span>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <button onClick={selectAll} className="text-[9px] font-mono text-primary hover:text-primary/80 transition-colors">
                {selectedIds.size === filtered.length ? t.cancel : t.selectAll}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={deleteSelected}
                  className="text-[9px] font-mono text-red-400 hover:text-red-300 transition-colors"
                >
                  {t.deleteSelected} ({selectedIds.size})
                </button>
              )}
              <button onClick={cancelSelect} className="text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors">
                ✕
              </button>
            </>
          ) : (
            orders.length > 0 && onDeleteOrder && (
              <button
                onClick={() => setSelectMode(true)}
                className="text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
              >
                {t.select}
              </button>
            )
          )}
          {!selectMode && (
            <span className="text-[10px] font-mono text-muted-foreground/40">{orders.length}</span>
          )}
        </div>
      </div>

      {/* Filter chips */}
      {!selectMode && (
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
      )}

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
                onDelete={!selectMode ? onDeleteOrder : undefined}
                selected={selectedIds.has(order.id)}
                onToggleSelect={selectMode ? toggleSelect : undefined}
              />
              {/* Status advance button */}
              {!selectMode && order.status !== 'delivered' && order.status !== 'cancelled' && onUpdateStatus && (
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
