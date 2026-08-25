import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { UploadedModel } from '@/components/STLUploadHandler';
import { type Material } from '@shared/domain/material';
import { type AgentId } from '@shared/domain/agent';
import { generateQuickReport, type ModelData } from '@/lib/ruleEngine';

const DEEP_STEP_AGENTS: AgentId[] = ['geometry_analyst', 'failure_predictor', 'optimization_advisor', 'printability_scorer'];

interface UseAnalysisProps {
  language: string;
  material: Material;
}

export function useAnalysis({ language, material }: UseAnalysisProps) {
  const [quickReport, setQuickReport] = useState('');
  const [agentRun, setAgentRun] = useState<any | null>(null);
  const [deepAgentRun, setDeepAgentRun] = useState<any | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState(false);
  const [deepSteps, setDeepSteps] = useState<Array<{ index: number; label: string; raw: string }>>([]);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [expertReview, setExpertReview] = useState<any | null>(null);
  const deepAnalysisSeq = useRef(0);
  const orchestratorRef = useRef<any>(null);
  const [agentLabelFns, setAgentLabelFns] = useState<{
    getAgentLabel: (id: any, lang?: any) => string;
    getAgentDescription: (id: any, lang?: any) => string;
  } | null>(null);

  useEffect(() => {
    import('@/agents').then(m => {
      orchestratorRef.current = new m.AgentOrchestrator();
      setAgentLabelFns({
        getAgentLabel: m.getAgentLabel,
        getAgentDescription: m.getAgentDescription,
      });
    });
  }, []);

  const getAgentLabelLazy = useCallback((id: any, lang?: any): string => {
    if (agentLabelFns) return agentLabelFns.getAgentLabel(id, lang);
    return id;
  }, [agentLabelFns]);

  const getAgentDescriptionLazy = useCallback((id: any, lang?: any): string => {
    if (agentLabelFns) return agentLabelFns.getAgentDescription(id, lang);
    return '';
  }, [agentLabelFns]);

  const resetAnalysis = useCallback(() => {
    setAgentRun(null);
    deepAnalysisSeq.current += 1;
    setDeepAgentRun(null);
    setExpertReview(null);
  }, []);

  const runAgentAnalysis = useCallback(async (model: UploadedModel, canvasEl: HTMLCanvasElement | null) => {
    if (!orchestratorRef.current) return;
    setAgentLoading(true);
    try {
      const ruleSummary = await orchestratorRef.current.runFullAnalysis(
        model.geometry,
        model.unifiedAnalysis,
        model.fileName,
        canvasEl,
        language,
        material,
      );
      setAgentRun(ruleSummary);
    } catch (err) {
      console.error('Rule analysis failed:', err);
    } finally {
      setAgentLoading(false);
    }
  }, [language, material]);

  const runDeepAnalysisIfConfigured = useCallback(async (model: UploadedModel, mat: Material) => {
    const seq = ++deepAnalysisSeq.current;
    setDeepAnalysisLoading(true);
    setDeepAgentRun(null);
    setDeepSteps([]);
    setDeepError(null);

    try {
      const agentsModule = await import('@/agents');
      const { runDeepAnalysis } = agentsModule;

      const result = await runDeepAnalysis(model.unifiedAnalysis, language, (step: any, index: number) => {
        if (seq !== deepAnalysisSeq.current) return;
        const agentId = DEEP_STEP_AGENTS[index];
        setDeepSteps(prev => [...prev, {
          index,
          label: agentId ? getAgentLabelLazy(agentId, language as 'en' | 'ja' | 'zh') : 'Deep Analysis',
          raw: step.raw,
        }]);
      }, mat, (trace: any) => {
        if (seq !== deepAnalysisSeq.current) return;
        fetch('/api/agent-trace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trace),
        }).catch(() => {});
      });
      if (seq !== deepAnalysisSeq.current) return;
      if (result) {
        setDeepAgentRun(result);
      } else {
        setDeepError('Deep analysis failed');
      }
    } catch (err) {
      console.error('Deep LLM analysis failed:', err);
      if (seq === deepAnalysisSeq.current) setDeepError('Deep analysis failed');
    } finally {
      if (seq === deepAnalysisSeq.current) setDeepAnalysisLoading(false);
    }
  }, [language, getAgentLabelLazy]);

  return {
    quickReport, setQuickReport,
    agentRun, setAgentRun,
    deepAgentRun, setDeepAgentRun,
    agentLoading, setAgentLoading,
    deepAnalysisLoading,
    deepSteps, setDeepSteps,
    deepError,
    expertReview, setExpertReview,
    resetAnalysis,
    runAgentAnalysis,
    runDeepAnalysisIfConfigured,
    getAgentLabelLazy,
    getAgentDescriptionLazy,
  };
}
