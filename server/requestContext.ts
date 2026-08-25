/**
 * Request Context Middleware
 * 
 * Provides unique request IDs and timing for all API requests.
 * Enables correlation of logs across the request lifecycle.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

// Generate a unique request ID
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
    }
  }
}

/**
 * Middleware that adds request ID and timing to all requests
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.headers['x-request-id'] as string || generateRequestId();
  req.startTime = performance.now();

  // Add request ID to response headers
  res.setHeader('X-Request-Id', req.requestId);

  // Log request start
  logger.info(`${req.method} ${req.path}`, {
    context: 'api',
    requestId: req.requestId,
    metadata: {
      method: req.method,
      path: req.path,
      query: req.query,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    },
  });

  // Log response on finish
  res.on('finish', () => {
    const duration = Math.round(performance.now() - req.startTime);
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      context: 'api',
      requestId: req.requestId,
      duration,
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      },
    });
  });

  next();
}

/**
 * Error handling middleware
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled error', {
    context: 'api',
    requestId: req.requestId,
    error: err,
    metadata: {
      method: req.method,
      path: req.path,
    },
  });

  res.status(500).json({
    error: 'Internal server error',
    requestId: req.requestId,
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
  });
}

/**
 * 404 handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  logger.warn('Route not found', {
    context: 'api',
    requestId: req.requestId,
    metadata: {
      method: req.method,
      path: req.path,
    },
  });

  res.status(404).json({
    error: 'Not found',
    requestId: req.requestId,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
