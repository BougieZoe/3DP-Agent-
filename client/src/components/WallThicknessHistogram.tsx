import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { WallThicknessSample } from '../analysis/types';
import { PANEL } from '../lib/visualLanguage';

interface WallThicknessHistogramProps {
  samples: WallThicknessSample[];
  thinWallThresholdMm: number;
  lang?: string;
  labels: {
    title: string;
    noData: string;
    sparse: string;
    samples: string;
    range: string;
  };
}

const BINS = 12;

export function getBinColor(val: number, threshold: number): string {
  return val <= threshold ? '#cc6666' : '#66ccff';
}

export function binSamples(samples: WallThicknessSample[], binCount: number = BINS) {
  const valid = samples.filter(s => s.thickness > 0 && s.confidence > 0.1);
  if (valid.length === 0) return { bins: [], min: 0, max: 0, validCount: 0 };

  const thicknesses = valid.map(s => s.thickness);
  const min = Math.min(...thicknesses);
  const max = Math.max(...thicknesses);

  if (min === max) {
    return {
      bins: [{ range: `${min.toFixed(2)}`, count: valid.length, minVal: min, maxVal: min }],
      min,
      max,
      validCount: valid.length,
    };
  }

  const binWidth = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => {
    const binMin = min + i * binWidth;
    const binMax = binMin + binWidth;
    const count = valid.filter(s => s.thickness >= binMin && (i === binCount - 1 ? s.thickness <= binMax : s.thickness < binMax)).length;
    return {
      range: `${binMin.toFixed(1)}`,
      count,
      minVal: binMin,
      maxVal: binMax,
    };
  });

  return { bins, min, max, validCount: valid.length };
}

export function WallThicknessHistogram({
  samples,
  thinWallThresholdMm,
  labels,
}: WallThicknessHistogramProps) {
  const { bins, validCount } = useMemo(() => binSamples(samples, BINS), [samples]);

  if (validCount === 0) {
    return (
      <div className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.padding}`}>
        <div className={`${PANEL.fontLabel} mb-2`}>{labels.title}</div>
        <div className="flex items-center justify-center h-16">
          <span className="text-[11px] font-mono text-muted-foreground/50">{labels.noData}</span>
        </div>
      </div>
    );
  }

  const isSparse = validCount < 5;

  return (
    <div className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.padding}`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`${PANEL.fontLabel}`}>{labels.title}</div>
        <div className="flex items-center gap-2">
          {isSparse && (
            <span className="text-[9px] font-mono text-yellow-400/70">{labels.sparse}</span>
          )}
          <span className={`${PANEL.fontTiny} text-muted-foreground/40`}>
            {validCount} {labels.samples}
          </span>
        </div>
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
            <XAxis
              dataKey="range"
              tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))', opacity: 0.5 }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(BINS / 6))}
            />
            <YAxis
              tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))', opacity: 0.5 }}
              axisLine={false}
              tickLine={false}
              width={24}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                    <div className="font-mono text-muted-foreground">
                      {d.range}–{d.maxVal?.toFixed(1)} mm
                    </div>
                    <div className="font-mono font-medium tabular-nums">
                      {d.count} samples
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={20}>
              {bins.map((entry, i) => (
                <Cell
                  key={i}
                  fill={getBinColor(entry.minVal, thinWallThresholdMm)}
                  fillOpacity={0.7}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Thin-wall threshold indicator */}
      <div className="flex items-center gap-1.5 mt-1">
        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#cc6666', opacity: 0.7 }} />
        <span className={`${PANEL.fontTiny} text-muted-foreground/40`}>
          &le; {thinWallThresholdMm} mm (thin wall)
        </span>
        <div className="w-2 h-2 rounded-sm ml-2" style={{ backgroundColor: '#66ccff', opacity: 0.7 }} />
        <span className={`${PANEL.fontTiny} text-muted-foreground/40`}>
          &gt; {thinWallThresholdMm} mm
        </span>
      </div>
    </div>
  );
}
