export type AIProviderId =
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'kimi'
  | 'amd-cloud'
  | 'fireworks'
  | 'zhipu';

export interface AIProviderMetadata {
  id: AIProviderId;
  label: string;
  shortLabel: string;
  keyPlaceholder: string;
  color: string; // hex color for inline style
}

export const AI_PROVIDERS: readonly AIProviderMetadata[] = [
  {
    id: 'claude',
    label: 'Anthropic Claude',
    shortLabel: 'Claude',
    keyPlaceholder: 'sk-ant-api03-...',
    color: '#fb923c', // orange-400
  },
  {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    keyPlaceholder: 'sk-proj-...',
    color: '#34d399', // emerald-400
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    keyPlaceholder: 'AIzaSy...',
    color: '#60a5fa', // blue-400
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    color: '#a78bfa', // purple-400
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    shortLabel: 'Kimi',
    keyPlaceholder: 'sk-...',
    color: '#38bdf8', // sky-400
  },
  {
    id: 'amd-cloud',
    label: 'AMD Cloud',
    shortLabel: 'AMD',
    keyPlaceholder: 'No API key required',
    color: '#f87171', // red-400
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    shortLabel: 'Fireworks',
    keyPlaceholder: 'fw_...',
    color: '#fbbf24', // amber-400
  },
  {
    id: 'zhipu',
    label: 'GLM (Zhipu)',
    shortLabel: 'GLM',
    keyPlaceholder: 'id.secret',
    color: '#a78bfa', // violet-400
  },
] as const;

export const AI_PROVIDER_METADATA: Record<AIProviderId, AIProviderMetadata> =
  AI_PROVIDERS.reduce(
    (providers, provider) => {
      providers[provider.id] = provider;
      return providers;
    },
    {} as Record<AIProviderId, AIProviderMetadata>,
  );