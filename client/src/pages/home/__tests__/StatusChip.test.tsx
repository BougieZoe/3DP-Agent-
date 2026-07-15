/// <reference types="vitest/globals" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip } from '../StatusChip';

describe('StatusChip', () => {
  it('renders label text', () => {
    render(<StatusChip status="good" label="OK" />);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('applies good styles for good status', () => {
    const { container } = render(<StatusChip status="good" label="Good" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('text-emerald-400');
  });

  it('applies warning styles for warning status', () => {
    const { container } = render(<StatusChip status="warning" label="Warn" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('text-yellow-400');
  });

  it('applies critical styles for critical status', () => {
    const { container } = render(<StatusChip status="critical" label="Bad" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('text-red-400');
  });
});
