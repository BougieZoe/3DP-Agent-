import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react';
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
      ctx.progressRef.current = next;
      ctx.layerRef.current = Math.floor(next * (ctx.state.totalLayers - 1));
    }
  });

  return null;
}

export function usePrintPlayback(): PlaybackContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePrintPlayback must be used within a PrintPlaybackProvider');
  return ctx;
}
