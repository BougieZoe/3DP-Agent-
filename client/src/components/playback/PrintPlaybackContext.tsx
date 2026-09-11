import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';

export interface PlaybackState {
  progress: number;
  currentLayer: number;
  totalLayers: number;
  isPlaying: boolean;
  speed: number;
  loop: boolean;
}

export interface PlaybackContextValue {
  state: PlaybackState;
  progressRef: React.MutableRefObject<number>;
  layerRef: React.MutableRefObject<number>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setProgress: (n: number) => void;
  setSpeed: (n: number) => void;
}

const Ctx = createContext<PlaybackContextValue | null>(null);

export function PrintPlaybackProvider({ totalLayers, children }: { totalLayers: number; children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>({
    progress: 0, currentLayer: 0, totalLayers,
    isPlaying: true, speed: 1, loop: true,
  });

  const progressRef = useRef(0);
  const layerRef = useRef(0);

  // New model (or new layer count) → restart playback. Without this, state
  // keeps the previous model's totalLayers while setProgress already uses
  // the new one, producing impossible labels like L94/50.
  useEffect(() => {
    progressRef.current = 0;
    layerRef.current = 0;
    setState(s => (s.totalLayers === totalLayers ? s : { ...s, totalLayers, progress: 0, currentLayer: 0 }));
  }, [totalLayers]);

  const play = useCallback(() => setState(s => ({ ...s, isPlaying: true })), []);
  const pause = useCallback(() => setState(s => ({ ...s, isPlaying: false })), []);
  const togglePlay = useCallback(() => setState(s => ({ ...s, isPlaying: !s.isPlaying })), []);

  const setProgress = useCallback((n: number) => {
    const p = Math.max(0, Math.min(1, n));
    progressRef.current = p;
    const layer = Math.floor(p * (totalLayers - 1));
    layerRef.current = layer;
    setState(s => ({ ...s, progress: p, currentLayer: layer }));
  }, [totalLayers]);

  const setSpeed = useCallback((n: number) => setState(s => ({ ...s, speed: n })), []);

  return (
    <Ctx.Provider value={{ state, progressRef, layerRef, play, pause, togglePlay, setProgress, setSpeed }}>
      {children}
    </Ctx.Provider>
  );
}

export function PlaybackUpdater() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;

  useFrame((_, delta) => {
    if (!ctx.state.isPlaying) return;
    const next = ctx.progressRef.current + delta * ctx.state.speed * 0.12;
    if (next >= 1) {
      if (ctx.state.loop) {
        ctx.setProgress(0);
      } else {
        ctx.setProgress(1);
        ctx.pause();
      }
    } else {
      // Sync React state only on layer change (~50/cycle): per-frame setState
      // would re-render 60×/s. The old code never synced, so the Lx/50 + %
      // label froze at 0 while the ref (and all overlays) kept advancing.
      const layer = Math.floor(next * (ctx.state.totalLayers - 1));
      if (layer !== ctx.layerRef.current) {
        ctx.setProgress(next);
      } else {
        ctx.progressRef.current = next;
      }
    }
  });

  return null;
}

export function usePrintPlayback(): PlaybackContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePrintPlayback must be used within a PrintPlaybackProvider');
  return ctx;
}
