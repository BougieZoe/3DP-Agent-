/// <reference types="vitest/globals" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricRow } from '../MetricRow';

describe('MetricRow', () => {
  it('renders label and value', () => {
    render(<MetricRow label="Volume" value={42.5} />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('42.5')).toBeInTheDocument();
  });

  it('renders unit suffix', () => {
    render(<MetricRow label="Weight" value={100} unit="g" />);
    expect(screen.getByText('g')).toBeInTheDocument();
  });

  it('highlights value when highlight prop is true', () => {
    const { container } = render(<MetricRow label="Status" value="Pass" highlight />);
    const valueSpan = container.querySelector('.text-primary');
    expect(valueSpan).toBeTruthy();
    expect(valueSpan!.textContent).toContain('Pass');
  });

  it('does not highlight by default', () => {
    const { container } = render(<MetricRow label="Status" value="Normal" />);
    const valueSpan = container.querySelector('.text-foreground');
    expect(valueSpan).toBeTruthy();
  });
});
