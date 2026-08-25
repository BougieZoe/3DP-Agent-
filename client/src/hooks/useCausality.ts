import { useState, useEffect, useMemo } from 'react';

interface CausalityEngines {
  buildCausalityGraph: any;
  detectPatterns: any;
  evaluateCounterfactuals: any;
}

export function useCausality(agentMarkers: any[], supportStatus: string | null, language: string) {
  const [causalityEngines, setCausalityEngines] = useState<CausalityEngines | null>(null);

  useEffect(() => {
    Promise.all([
      import('@/components/causality/causalityEngine'),
      import('@/components/causality/topologyPatternEngine'),
      import('@/components/causality/counterfactualEngine'),
    ]).then(([causality, pattern, counterfactual]) => {
      setCausalityEngines({
        buildCausalityGraph: causality.buildCausalityGraph,
        detectPatterns: pattern.detectPatterns,
        evaluateCounterfactuals: counterfactual.evaluateCounterfactuals,
      });
    });
  }, []);

  const causalityGraph = useMemo(() => {
    if (!causalityEngines || agentMarkers.length === 0) return null;
    return causalityEngines.buildCausalityGraph(agentMarkers, supportStatus, language);
  }, [causalityEngines, agentMarkers, supportStatus, language]);

  const patternMatches = useMemo(() => {
    if (!causalityEngines || agentMarkers.length === 0) return [];
    return causalityEngines.detectPatterns(agentMarkers, language);
  }, [causalityEngines, agentMarkers, language]);

  const counterfactualSuggestions = useMemo(() => {
    if (!causalityEngines || agentMarkers.length === 0) return [];
    return causalityEngines.evaluateCounterfactuals(agentMarkers, patternMatches, language);
  }, [causalityEngines, agentMarkers, patternMatches, language]);

  return {
    causalityEngines,
    causalityGraph,
    patternMatches,
    counterfactualSuggestions,
  };
}
