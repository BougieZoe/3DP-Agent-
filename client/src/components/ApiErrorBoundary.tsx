/**
 * API Error Boundary
 * 
 * React component that catches API errors and displays them gracefully.
 * Provides retry functionality and error details in development mode.
 */

import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
}

class ApiErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    
    // Log to error tracking service in production
    if (process.env.NODE_ENV === 'production') {
      console.error('[ApiErrorBoundary]', error, errorInfo);
    }
  }

  handleRetry = (): void => {
    this.setState({ 
      hasError: false, 
      error: null, 
      errorInfo: null,
      copied: false,
    });
  };

  handleCopyError = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    const errorText = [
      `Error: ${error?.message}`,
      `Stack: ${error?.stack}`,
      errorInfo?.componentStack ? `Component Stack: ${errorInfo.componentStack}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      await navigator.clipboard.writeText(errorText);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: ignore copy failure
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[200px] p-6">
          <div className="flex flex-col items-center w-full max-w-md">
            <AlertTriangle
              size={40}
              className="text-amber-500 mb-4"
            />
            
            <h3 className="text-lg font-semibold mb-2">
              Something went wrong
            </h3>
            
            <p className="text-sm text-muted-foreground text-center mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>

            <div className="flex gap-2">
              <button
                onClick={this.handleRetry}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg",
                  "bg-primary text-primary-foreground",
                  "hover:opacity-90 transition-opacity"
                )}
              >
                <RefreshCw size={16} />
                Retry
              </button>
              
              <button
                onClick={this.handleCopyError}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg",
                  "bg-muted text-muted-foreground",
                  "hover:bg-muted/80 transition-colors"
                )}
              >
                {this.state.copied ? (
                  <>
                    <Check size={16} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    Copy Error
                  </>
                )}
              </button>
            </div>

            {process.env.NODE_ENV !== 'production' && this.state.errorInfo && (
              <details className="mt-4 w-full">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Error Details (Development)
                </summary>
                <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-40">
                  {this.state.error?.stack}
                  {'\n\n'}
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ApiErrorBoundary;
