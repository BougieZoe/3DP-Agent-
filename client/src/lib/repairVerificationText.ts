import type { Language } from '@/lib/i18n';
import { getTranslation } from '@/lib/i18n';
import type {
  RepairImprovement,
  RepairRegression,
  RepairVerification,
} from './repairVerification';

const fmt = (value: number | null, language: Language, digits = 3): string =>
  value === null
    ? getTranslation(language, 'verdictUnknownValue')
    : value.toFixed(digits);

function regressionLabel(
  regression: RepairRegression,
  language: Language
): string {
  switch (regression.code) {
    case 'baseline_unavailable':
      return getTranslation(language, 'repairIssueNoBaseline');
    case 'analysis_unavailable':
      return getTranslation(language, 'repairIssueNoAnalysis');
    case 'empty_result':
      return getTranslation(language, 'repairIssueEmptyMesh');
    case 'non_manifold_increased':
      return getTranslation(language, 'repairMetricNonManifold', {
        from: fmt(regression.before, language, 0),
        to: fmt(regression.after, language, 0),
      });
    case 'boundary_increased':
      return getTranslation(language, 'repairMetricBoundary', {
        from: fmt(regression.before, language, 0),
        to: fmt(regression.after, language, 0),
      });
    case 'holes_increased':
      return getTranslation(language, 'repairMetricHoles', {
        from: fmt(regression.before, language, 0),
        to: fmt(regression.after, language, 0),
      });
    case 'min_wall_decreased':
      return getTranslation(language, 'repairMetricMinWall', {
        from: fmt(regression.before, language),
        to: fmt(regression.after, language),
      });
    case 'p5_wall_decreased':
      return getTranslation(language, 'repairMetricP5Wall', {
        from: fmt(regression.before, language),
        to: fmt(regression.after, language),
      });
    case 'watertight_lost':
      return getTranslation(language, 'repairWatertightLost');
    case 'volume_unreliable':
      return getTranslation(language, 'repairVolumeUnreliable');
    case 'volume_implausible': {
      const ratio =
        regression.before !== null &&
        regression.after !== null &&
        regression.before > 0
          ? (regression.after / regression.before).toFixed(2)
          : getTranslation(language, 'verdictUnknownValue');
      return getTranslation(language, 'repairMetricVolume', {
        from: fmt(regression.before, language, 0),
        to: fmt(regression.after, language, 0),
        ratio,
      });
    }
  }
}

function improvementLabel(
  improvement: RepairImprovement,
  verification: RepairVerification,
  language: Language
): string {
  const before = verification.before;
  const after = verification.after;
  switch (improvement.code) {
    case 'watertight_gained':
      return getTranslation(language, 'repairWatertightGained');
    case 'non_manifold_reduced':
      return getTranslation(language, 'repairMetricNonManifold', {
        from: fmt(before?.nonManifoldEdgeCount ?? null, language, 0),
        to: fmt(after?.nonManifoldEdgeCount ?? null, language, 0),
      });
    case 'boundary_reduced':
      return getTranslation(language, 'repairMetricBoundary', {
        from: fmt(before?.boundaryEdgeCount ?? null, language, 0),
        to: fmt(after?.boundaryEdgeCount ?? null, language, 0),
      });
    case 'holes_reduced':
      return getTranslation(language, 'repairMetricHoles', {
        from: fmt(before?.holeCount ?? null, language, 0),
        to: fmt(after?.holeCount ?? null, language, 0),
      });
    case 'min_wall_increased':
      return getTranslation(language, 'repairMetricMinWall', {
        from: fmt(before?.minWallThicknessMm ?? null, language),
        to: fmt(after?.minWallThicknessMm ?? null, language),
      });
    case 'p5_wall_increased':
      return getTranslation(language, 'repairMetricP5Wall', {
        from: fmt(before?.p5WallThicknessMm ?? null, language),
        to: fmt(after?.p5WallThicknessMm ?? null, language),
      });
    case 'volume_reliability_gained':
      return getTranslation(language, 'repairVolumeReliable');
  }
}

export interface RepairVerificationText {
  title: string;
  summary: string;
  regressions: string[];
}

export function describeRepairVerification(
  verification: RepairVerification,
  language: Language
): RepairVerificationText {
  const title = getTranslation(
    language,
    verification.accepted ? 'repairVerified' : 'repairDiscarded'
  );
  const regressions = verification.regressions.map(regression =>
    regressionLabel(regression, language)
  );
  const improvements = verification.improvements.map(improvement =>
    improvementLabel(improvement, verification, language)
  );
  const summary = !verification.accepted
    ? getTranslation(language, 'repairRejectedWith', {
        items: regressions.join('; '),
      })
    : improvements.length > 0
      ? getTranslation(language, 'repairVerifiedWith', {
          items: improvements.join('; '),
        })
      : getTranslation(language, 'repairVerifiedNoRegression');

  return { title, summary, regressions };
}
