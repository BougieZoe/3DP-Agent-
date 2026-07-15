/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

const Boom = () => { throw new Error('💥'); };

function suppressErrorLog() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
}
function restoreErrorLog() {
  vi.restoreAllMocks();
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders error UI when a child throws', () => {
    suppressErrorLog();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument();
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
    restoreErrorLog();
  });

  it('displays the error stack trace', () => {
    suppressErrorLog();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/💥/)).toBeInTheDocument();
    restoreErrorLog();
  });
});
