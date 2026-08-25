/**
 * Graceful Shutdown Handler
 * 
 * Ensures clean shutdown by:
 * 1. Stopping new connections
 * 2. Draining existing requests
 * 3. Cleaning up resources
 * 4. Exiting with appropriate code
 */

import { Server } from 'http';
import { logger } from './logger';

const SHUTDOWN_TIMEOUT = parseInt(process.env.SHUTDOWN_TIMEOUT ?? '10000', 10);

let isShuttingDown = false;
let server: Server | null = null;

/**
 * Initialize shutdown handler
 */
export function initShutdown(srv: Server): void {
  server = srv;
  
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      context: 'shutdown',
      error,
    });
    // Give the logger time to write before exiting
    setTimeout(() => {
      process.exit(1);
    }, 100);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      context: 'shutdown',
      metadata: { reason: String(reason) },
    });
  });
}

/**
 * Handle shutdown signal
 */
async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Already shutting down, ignoring signal', {
      context: 'shutdown',
      metadata: { signal },
    });
    return;
  }

  isShuttingDown = true;
  logger.info('Shutdown initiated', {
    context: 'shutdown',
    metadata: { signal, timeout: SHUTDOWN_TIMEOUT },
  });

  // Set timeout for forced shutdown
  const forceShutdownTimer = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit', {
      context: 'shutdown',
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  // Allow timer to not prevent process exit
  forceShutdownTimer.unref();

  try {
    // Stop accepting new connections
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      logger.info('Server stopped accepting connections', {
        context: 'shutdown',
      });
    }

    // Additional cleanup can be added here
    // e.g., close database connections, flush logs, etc.

    logger.info('Shutdown complete', {
      context: 'shutdown',
    });

    clearTimeout(forceShutdownTimer);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      context: 'shutdown',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    clearTimeout(forceShutdownTimer);
    process.exit(1);
  }
}

/**
 * Check if server is shutting down
 */
export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}
