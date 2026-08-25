/**
 * Health Check Endpoint
 * 
 * Provides comprehensive health status for:
 * - Load balancers
 * - Kubernetes readiness/liveness probes
 * - Monitoring systems
 */

import { Router } from 'express';
import { logger } from './logger';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    memory: HealthCheck;
    slicer: HealthCheck;
    stepParser: HealthCheck;
  };
}

interface HealthCheck {
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  duration?: number;
}

const startTime = Date.now();
const version = process.env.npm_package_version ?? 'unknown';

/**
 * Basic health check (for load balancers)
 */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Detailed health check (for monitoring)
 */
router.get('/health/detailed', async (_req, res) => {
  const checks: HealthStatus['checks'] = {
    memory: checkMemory(),
    slicer: await checkSlicer(),
    stepParser: await checkStepParser(),
  };

  const status = determineOverallStatus(checks);

  const health: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
    environment: process.env.NODE_ENV ?? 'development',
    checks,
  };

  const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Readiness probe (for Kubernetes)
 */
router.get('/ready', async (_req, res) => {
  const memory = checkMemory();
  const ready = memory.status !== 'fail';
  
  res.status(ready ? 200 : 503).json({
    ready,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Liveness probe (for Kubernetes)
 */
router.get('/live', (_req, res) => {
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

function checkMemory(): HealthCheck {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const usagePercent = Math.round((heapUsedMB / heapTotalMB) * 100);

  if (usagePercent > 90) {
    return { status: 'fail', message: `Heap usage critical: ${usagePercent}% (${heapUsedMB}MB/${heapTotalMB}MB)` };
  }
  if (usagePercent > 70) {
    return { status: 'warn', message: `Heap usage high: ${usagePercent}% (${heapUsedMB}MB/${heapTotalMB}MB)` };
  }
  return { status: 'pass', message: `Heap usage normal: ${usagePercent}% (${heapUsedMB}MB/${heapTotalMB}MB)` };
}

async function checkSlicer(): Promise<HealthCheck> {
  try {
    // Dynamic import to check if slicer module is loadable
    const slicerBridge = await import('./slicerBridge');
    return {
      status: 'pass',
      message: 'Slicer module available',
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `Slicer check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function checkStepParser(): Promise<HealthCheck> {
  try {
    const { isValidStepFile } = await import('./stepParser');
    return {
      status: 'pass',
      message: 'STEP parser module loaded',
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `STEP parser check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

function determineOverallStatus(checks: HealthStatus['checks']): HealthStatus['status'] {
  const statuses = Object.values(checks).map(c => c.status);
  
  if (statuses.some(s => s === 'fail')) return 'unhealthy';
  if (statuses.some(s => s === 'warn')) return 'degraded';
  return 'healthy';
}

export default router;
