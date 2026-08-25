/**
 * Performance Monitor
 * 
 * Client-side performance monitoring:
 * - Web Vitals (LCP, FID, CLS)
 * - API call timing
 * - Analysis performance
 * - Memory usage tracking
 */

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ApiCallMetric {
  endpoint: string;
  method: string;
  duration: number;
  status: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private apiCalls: ApiCallMetric[] = [];
  private observers: PerformanceObserver[] = [];
  private initialized = false;

  /**
   * Initialize performance monitoring
   */
  init(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    // Observe Long Tasks
    if ('PerformanceObserver' in window) {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.captureMetric({
              name: 'long_task',
              value: entry.duration,
              unit: 'ms',
              timestamp: Date.now(),
              metadata: {
                startTime: entry.startTime,
              },
            });
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true });
        this.observers.push(longTaskObserver);
      } catch {
        // Long task observer not supported
      }

      // Observe Layout Shifts (CLS)
      try {
        const layoutShiftObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if ('value' in entry) {
              this.captureMetric({
                name: 'layout_shift',
                value: (entry as any).value,
                unit: 'score',
                timestamp: Date.now(),
              });
            }
          }
        });
        layoutShiftObserver.observe({ type: 'layout-shift', buffered: true });
        this.observers.push(layoutShiftObserver);
      } catch {
        // Layout shift observer not supported
      }
    }

    // Track memory usage periodically
    this.startMemoryTracking();
  }

  /**
   * Capture a custom metric
   */
  captureMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    // Keep only last 1000 metrics
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-500);
    }
  }

  /**
   * Track API call performance
   */
  trackApiCall(call: ApiCallMetric): void {
    this.apiCalls.push(call);
    
    // Keep only last 500 API calls
    if (this.apiCalls.length > 500) {
      this.apiCalls = this.apiCalls.slice(-250);
    }
  }

  /**
   * Time an async operation
   */
  async time<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.captureMetric({
        name,
        value: duration,
        unit: 'ms',
        timestamp: Date.now(),
        metadata,
      });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.captureMetric({
        name: `${name}_error`,
        value: duration,
        unit: 'ms',
        timestamp: Date.now(),
        metadata: {
          ...metadata,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    totalMetrics: number;
    totalApiCalls: number;
    averageApiDuration: number;
    slowestApiCalls: ApiCallMetric[];
    recentMetrics: PerformanceMetric[];
  } {
    const avgApiDuration = this.apiCalls.length > 0
      ? this.apiCalls.reduce((sum, c) => sum + c.duration, 0) / this.apiCalls.length
      : 0;

    const slowestApiCalls = [...this.apiCalls]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    return {
      totalMetrics: this.metrics.length,
      totalApiCalls: this.apiCalls.length,
      averageApiDuration: Math.round(avgApiDuration),
      slowestApiCalls,
      recentMetrics: this.metrics.slice(-50),
    };
  }

  /**
   * Get Web Vitals
   */
  async getWebVitals(): Promise<Record<string, number>> {
    const vitals: Record<string, number> = {};

    // Get LCP
    try {
      const lcpEntry = await new Promise<PerformanceEntry>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1]);
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => observer.disconnect(), 1000);
      });
      vitals.lcp = lcpEntry.startTime;
    } catch {
      // LCP not supported
    }

    return vitals;
  }

  private startMemoryTracking(): void {
    if (!('memory' in performance)) return;

    const trackMemory = () => {
      const mem = (performance as any).memory;
      this.captureMetric({
        name: 'memory_usage',
        value: mem.usedJSHeapSize / 1024 / 1024,
        unit: 'MB',
        timestamp: Date.now(),
        metadata: {
          total: mem.totalJSHeapSize / 1024 / 1024,
          limit: mem.jsHeapSizeLimit / 1024 / 1024,
        },
      });
    };

    // Track every 30 seconds
    setInterval(trackMemory, 30000);
    trackMemory();
  }

  /**
   * Cleanup observers
   */
  destroy(): void {
    this.observers.forEach(obs => obs.disconnect());
    this.observers = [];
    this.initialized = false;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();
