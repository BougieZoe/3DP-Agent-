// @vitest-environment happy-dom
/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalysisVerdictBar, type VerdictMetric } from '@/components/AnalysisVerdictBar';

const metrics: VerdictMetric[] = [
  { key: 'wall', label: 'MIN WALL', value: '—', against: 'not measured', status: 'unknown' },
  { key: 'overhang', label: 'OVERHANG', value: '—', against: 'not measured', status: 'unknown' },
];

const base = {
  fileName: 'bracket.stl',
  unitsLabel: 'mm',
  dims: { x: 10, y: 20, z: 30 },
  triangleCount: 12,
  confidence: 0,
  metrics,
  actions: [],
  level: 'unknown' as const,
  verdictLabel: 'INCONCLUSIVE',
};

describe('AnalysisVerdictBar — partial failure', () => {
  it('says which modules failed instead of printing an unexplained zero', () => {
    render(
      <AnalysisVerdictBar
        {...base}
        moduleErrors={[{ module: 'metrics', placeholder: true }]}
        moduleErrorsLabel={'{n} module(s) failed: {list}'}
      />,
    );
    expect(screen.getByText(/1 module\(s\) failed: metrics\*/)).toBeTruthy();
  });

  it('renders no warning strip on a clean run', () => {
    const { container } = render(<AnalysisVerdictBar {...base} />);
    expect(container.textContent).not.toContain('module(s) failed');
  });

  it('renders every supplied metric with its threshold reference', () => {
    const { container } = render(<AnalysisVerdictBar {...base} />);
    expect(container.textContent).toContain('MIN WALL');
    expect(container.textContent).toContain('not measured');
  });

  it('fires the action handler when an action is locatable', () => {
    const onClick = vi.fn();
    render(
      <AnalysisVerdictBar
        {...base}
        actions={[
          { text: 'Thicken walls below 0.8 mm', onActivate: onClick, active: true },
          { text: 'This one has no destination' },
        ]}
      />,
    );
    const btn = screen.getByRole('button', { name: /Thicken walls/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    // A plain action must not become a button.
    expect(screen.queryByRole('button', { name: /no destination/ })).toBeNull();
  });

  it('hides the confidence figure when it is zero', () => {
    const { container } = render(
      <AnalysisVerdictBar {...base} confidence={null} confidenceLabel="confidence" />,
    );
    expect(container.textContent).not.toContain('confidence');
  });
});
