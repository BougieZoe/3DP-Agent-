/**
 * Structured Logger for 3DP Agent Server
 * 
 * Production-grade logging with:
 * - Log levels (debug, info, warn, error)
 * - Structured JSON output
 * - Request context tracking
 * - Performance timing
 * - Error stack traces
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  requestId?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private level: LogLevel;
  private isProduction: boolean;

  constructor() {
    this.level = this.parseLogLevel(process.env.LOG_LEVEL ?? 'info');
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatEntry(entry: LogEntry): string {
    if (this.isProduction) {
      return JSON.stringify(entry);
    }
    
    const parts = [
      entry.timestamp,
      `[${entry.level}]`,
      entry.context ? `[${entry.context}]` : '',
      entry.requestId ? `[${entry.requestId}]` : '',
      entry.message,
      entry.duration !== undefined ? `(${entry.duration}ms)` : '',
    ];
    
    if (entry.metadata) {
      parts.push(JSON.stringify(entry.metadata));
    }
    
    return parts.filter(Boolean).join(' ');
  }

  private log(level: LogLevel, levelStr: string, message: string, options?: {
    context?: string;
    requestId?: string;
    duration?: number;
    metadata?: Record<string, unknown>;
    error?: Error;
  }): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelStr,
      message,
      ...options,
    };

    if (options?.error) {
      entry.error = {
        name: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
      };
    }

    const formatted = this.formatEntry(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, options?: { context?: string; metadata?: Record<string, unknown> }): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, options);
  }

  info(message: string, options?: { context?: string; requestId?: string; duration?: number; metadata?: Record<string, unknown> }): void {
    this.log(LogLevel.INFO, 'INFO', message, options);
  }

  warn(message: string, options?: { context?: string; requestId?: string; duration?: number; metadata?: Record<string, unknown> }): void {
    this.log(LogLevel.WARN, 'WARN', message, options);
  }

  error(message: string, options?: { context?: string; requestId?: string; duration?: number; error?: Error; metadata?: Record<string, unknown> }): void {
    this.log(LogLevel.ERROR, 'ERROR', message, options);
  }

  /**
   * Create a child logger with a fixed context
   */
  child(context: string): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Time an async operation
   */
  async time<T>(label: string, fn: () => Promise<T>, options?: { context?: string; requestId?: string }): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = Math.round(performance.now() - start);
      this.info(`${label} completed`, { ...options, duration });
      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      this.error(`${label} failed`, { 
        ...options, 
        duration, 
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private context: string
  ) {}

  debug(message: string, options?: { metadata?: Record<string, unknown> }): void {
    this.parent.debug(message, { context: this.context, ...options });
  }

  info(message: string, options?: { requestId?: string; metadata?: Record<string, unknown> }): void {
    this.parent.info(message, { context: this.context, ...options });
  }

  warn(message: string, options?: { requestId?: string; metadata?: Record<string, unknown> }): void {
    this.parent.warn(message, { context: this.context, ...options });
  }

  error(message: string, options?: { requestId?: string; error?: Error; metadata?: Record<string, unknown> }): void {
    this.parent.error(message, { context: this.context, ...options });
  }

  async time<T>(label: string, fn: () => Promise<T>, options?: { requestId?: string }): Promise<T> {
    return this.parent.time(label, fn, { context: this.context, ...options });
  }
}

// Singleton instance
export const logger = new Logger();

// Export child logger factories for different modules
export const slicerLogger = logger.child('slicer');
export const stepLogger = logger.child('step');
export const cadLogger = logger.child('cad');
export const meshLogger = logger.child('mesh');
export const apiLogger = logger.child('api');
