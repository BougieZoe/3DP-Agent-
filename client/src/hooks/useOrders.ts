/**
 * Order Store — Simple state management for orders
 *
 * Uses React state + localStorage persistence.
 * No external dependencies needed.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Order, OrderStatus } from '@shared/domain/order';
import { ORDER_STATUS_FLOW } from '@shared/domain/order';

const STORAGE_KEY = '3dp-agent-orders';

function generateOrderId(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOrders(orders: Order[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>(loadOrders);

  useEffect(() => {
    saveOrders(orders);
  }, [orders]);

  const createOrder = useCallback((partial: Partial<Order>): Order => {
    const order: Order = {
      id: generateOrderId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      supplierId: '',
      customerId: '',
      stlFileName: partial.stlFileName ?? 'untitled.stl',
      specs: partial.specs ?? {
        dimensions: { x: 0, y: 0, z: 0 },
        volumeMm3: 0,
        surfaceAreaMm2: 0,
        weightGrams: 0,
      },
      material: partial.material ?? 'PLA',
      technology: partial.technology ?? 'fdm',
      quantity: partial.quantity ?? 1,
      color: partial.color ?? '#FFFFFF',
      price: partial.price ?? {
        material: 0, machine: 0, labor: 0, shipping: 0, margin: 0,
        total: 0, currency: 'USD',
      },
      shipping: partial.shipping ?? {
        terms: 'DDP', origin: '', destination: '', carrier: '', eta: '', cost: 0,
      },
      status: 'draft',
      notes: partial.notes,
      messages: [],
    };

    setOrders(prev => [order, ...prev]);
    return order;
  }, []);

  const updateOrder = useCallback((id: string, updates: Partial<Order>) => {
    setOrders(prev => prev.map(o =>
      o.id === id ? { ...o, ...updates, updatedAt: new Date().toISOString() } : o
    ));
  }, []);

  const updateStatus = useCallback((id: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o =>
      o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o
    ));
  }, []);

  const deleteOrder = useCallback((id: string) => {
    setOrders(prev => prev.filter(o => o.id !== id));
  }, []);

  const getNextStatus = useCallback((current: OrderStatus): OrderStatus | null => {
    const idx = ORDER_STATUS_FLOW.indexOf(current);
    return idx < ORDER_STATUS_FLOW.length - 1 ? ORDER_STATUS_FLOW[idx + 1] : null;
  }, []);

  const ordersByStatus = useCallback((status: OrderStatus) => {
    return orders.filter(o => o.status === status);
  }, [orders]);

  return {
    orders,
    createOrder,
    updateOrder,
    updateStatus,
    deleteOrder,
    getNextStatus,
    ordersByStatus,
  };
}
