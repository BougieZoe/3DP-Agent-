import { useState, useEffect, useCallback } from 'react';
import { supabase, type User } from '@/lib/supabase';
import type { UnifiedAnalysis } from '@/analysis';
import type { Session } from '@supabase/supabase-js';

function deriveWtStatus(mm: number | null | undefined): 'good' | 'warning' | 'critical' {
  if (mm == null) return 'warning';
  if (mm < 1) return 'critical';
  if (mm < 2) return 'warning';
  return 'good';
}

function deriveOhStatus(faceCount: number | undefined, totalTriangles: number | undefined): 'good' | 'warning' | 'critical' {
  if (!faceCount || faceCount === 0) return 'good';
  const ratio = totalTriangles && totalTriangles > 0 ? faceCount / totalTriangles : 0;
  if (ratio > 0.3) return 'critical';
  if (ratio > 0.1) return 'warning';
  return 'good';
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? '' });
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? '' });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { user, signIn, signUp, signOut, loading };
}

export async function saveAnalysis(analysis: UnifiedAnalysis, fileName: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  const metrics = analysis.metrics.result;
  const topology = analysis.topology.result;
  const oh = metrics?.overhang;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const minWall = metrics?.minWallThicknessMm;
  const triCount = topology?.triangleCount ?? 0;

  await supabase.from('analyses').insert({
    user_id: session.user.id,
    file_name: fileName,
    volume_mm3: metrics?.meshVolumeMm3 ?? 0,
    dims: dims,
    wall_status: deriveWtStatus(minWall),
    overhang_status: deriveOhStatus(oh?.faceCount, triCount),
  });
}
