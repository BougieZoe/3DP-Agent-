/**
 * Print Dashboard Component
 *
 * Real-time monitoring dashboard for 3D print jobs:
 * - Webcam preview
 * - Progress ring
 * - Failure alerts
 * - Remaining time
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createWebcamController, imageDataToBase64, type WebcamController, type CapturedFrame } from '@/lib/webcam';
import { estimatePrintProgress, type PrintProgressEstimate } from '@/lib/printProgress';
import { detectFailures, type FailureDetectionResult, type FailureType } from '@/lib/failureDetection';

interface PrintDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  totalHeightMm?: number;
  layerHeightMm?: number;
}

export function PrintDashboard({
  isOpen,
  onClose,
  totalHeightMm = 100,
  layerHeightMm = 0.2,
}: PrintDashboardProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [progress, setProgress] = useState<PrintProgressEstimate | null>(null);
  const [detection, setDetection] = useState<FailureDetectionResult | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const webcamRef = useRef<WebcamController | null>(null);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start webcam
  const startCapture = useCallback(async () => {
    try {
      const controller = createWebcamController({
        width: 640,
        height: 480,
        facingMode: 'environment',
        frameIntervalMs: 5000,
      });

      await controller.start();
      webcamRef.current = controller;
      setIsCapturing(true);

      // Listen for frames
      controller.onFrame(async (frame: CapturedFrame) => {
        // Update preview
        setLastFrame(imageDataToBase64(frame.imageData));

        // Run failure detection every 10 seconds
        if (frame.index % 2 === 0) {
          const result = await detectFailures(frame.imageData);
          setDetection(result);
        }
      });
    } catch (err) {
      console.error('Failed to start webcam:', err);
    }
  }, []);

  // Stop webcam
  const stopCapture = useCallback(() => {
    webcamRef.current?.stop();
    webcamRef.current = null;
    setIsCapturing(false);
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  // Simulate progress (in production, this would come from the webcam analysis)
  useEffect(() => {
    if (!isCapturing) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        const currentPct = prev?.percentage || 0;
        if (currentPct >= 100) return prev;

        const newPct = Math.min(100, currentPct + 0.5);
        return estimatePrintProgress(
          (newPct / 100) * totalHeightMm,
          { totalHeightMm, layerHeightMm }
        );
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isCapturing, totalHeightMm, layerHeightMm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-background border border-border/40 rounded-lg p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-mono font-semibold">Print Monitor</h2>
          <button
            onClick={() => { stopCapture(); onClose(); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Webcam Preview */}
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-4">
          {lastFrame ? (
            <img
              src={`data:image/png;base64,${lastFrame}`}
              alt="Webcam preview"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {isCapturing ? 'Starting camera...' : 'Click "Start Monitoring" to begin'}
            </div>
          )}

          {/* Progress overlay */}
          {progress && (
            <div className="absolute top-4 right-4 bg-black/70 rounded-lg p-3">
              <div className="relative w-16 h-16">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <circle
                    cx="18" cy="18" r="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-muted/20"
                  />
                  <circle
                    cx="18" cy="18" r="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={`${progress.percentage} 100`}
                    className="text-cyan-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-mono">
                  {progress.percentage.toFixed(0)}%
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-cyan-400">
              {progress?.percentage.toFixed(1) || '0'}%
            </div>
            <div className="text-xs text-muted-foreground">Progress</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-amber-400">
              {progress?.remainingMinutes.toFixed(0) || '—'}
            </div>
            <div className="text-xs text-muted-foreground">Min Left</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-mono font-bold ${
              detection?.overallHealth === 'good' ? 'text-green-400' :
              detection?.overallHealth === 'warning' ? 'text-amber-400' :
              'text-red-400'
            }`}>
              {detection?.overallHealth === 'good' ? '✓' :
               detection?.overallHealth === 'warning' ? '!' : '✕'}
            </div>
            <div className="text-xs text-muted-foreground">Health</div>
          </div>
        </div>

        {/* Failure Alerts */}
        {detection && detection.failures.length > 0 && (
          <div className="space-y-2 mb-4">
            {detection.failures.map((failure, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border ${
                  failure.severity === 'critical' ? 'border-red-500/50 bg-red-500/10' :
                  failure.severity === 'high' ? 'border-amber-500/50 bg-amber-500/10' :
                  'border-border/40 bg-muted/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono capitalize">{failure.type.replace('_', ' ')}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    failure.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    failure.severity === 'high' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-muted/40 text-muted-foreground'
                  }`}>
                    {failure.severity}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{failure.description}</p>
                <p className="text-xs text-cyan-400 mt-1">{failure.suggestedAction}</p>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3">
          {!isCapturing ? (
            <button
              onClick={startCapture}
              className="flex-1 py-2 px-4 bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 rounded-lg font-mono text-sm hover:bg-cyan-500/30 transition-colors"
            >
              Start Monitoring
            </button>
          ) : (
            <button
              onClick={stopCapture}
              className="flex-1 py-2 px-4 bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg font-mono text-sm hover:bg-amber-500/30 transition-colors"
            >
              Stop Monitoring
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
