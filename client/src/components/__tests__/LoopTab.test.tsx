// @vitest-environment happy-dom
/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoopTab } from '@/components/LoopTab';
import { MATERIALS } from '@shared/domain/material';
import type { UnifiedAnalysis } from '@/analysis/types';

function analysisWithLoop(): UnifiedAnalysis {
  return {
    loop: {
      moduleName: 'loop',
      confidence: 0.9,
      durationMs: 1,
      result: {
        firstTime: {
          score: 85,
          expectedFailureCostUsd: 0.12,
          drivers: ['support difficulty: moderate (−12)', 'thin walls 9.5% of samples (−2)'],
        },
        waste: {
          partGrams: 7.6,
          supportGrams: 0.1,
          processLossGrams: 0.8,
          totalWasteGrams: 0.9,
          wasteRatio: 0.115,
          fate: 'recyclable',
          fateReason: 'Mechanically recyclable — collect scrap for regrind.',
          contaminated: false,
        },
        eol: {
          monthsCompost: [2, 5],
          marineDegradable: false,
          geometryFactor: 0.75,
          basisNote: 'Class data.',
        },
      },
      explanation: '',
    },
  } as never;
}

describe('LoopTab', () => {
  it('renders score, fate and end-of-life from the loop module', () => {
    render(
      <LoopTab
        unifiedAnalysis={analysisWithLoop()}
        material={MATERIALS.PLA}
        language="en"
        onNavigate={() => {}}
      />
    );
    // Band headline up front, heuristic number secondary.
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/启发式|Heuristic|ヒューリ/i)).toBeInTheDocument();
    // Fate badge + matrix rows share fate labels — badge plus at least one row.
    expect(screen.getAllByText('recyclable').length).toBeGreaterThanOrEqual(2);
    // Range, never a point estimate.
    expect(screen.getByText(/~2–5/)).toBeInTheDocument();
    expect(screen.getByText(/support difficulty: moderate/)).toBeInTheDocument();
  });

  it('navigates to geometry on driver click and agents on optimize', () => {
    const onNavigate = vi.fn();
    render(
      <LoopTab
        unifiedAnalysis={analysisWithLoop()}
        material={MATERIALS.PLA}
        language="en"
        onNavigate={onNavigate}
      />
    );
    fireEvent.click(screen.getByText(/support difficulty: moderate/));
    expect(onNavigate).toHaveBeenCalledWith('geometry');
    fireEvent.click(screen.getByText(/Optimize in AGENTS/));
    expect(onNavigate).toHaveBeenCalledWith('agents');
  });

  it('lists the generic bio material in the matrix without trademarks', () => {
    const { container } = render(
      <LoopTab
        unifiedAnalysis={analysisWithLoop()}
        material={MATERIALS.PLA}
        language="en"
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText('Cellulose Acetate (Bio)')).toBeInTheDocument();
    // No brand names anywhere in the tab — generic class data only.
    expect(container.textContent).not.toMatch(/CAFBLO/i);
    expect(container.textContent).not.toMatch(/Daicel/i);
  });

  it('shows a note when the loop module did not run', () => {
    render(
      <LoopTab
        unifiedAnalysis={{} as never}
        material={MATERIALS.PLA}
        language="en"
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText(/run analysis with a material/i)).toBeInTheDocument();
  });
});
