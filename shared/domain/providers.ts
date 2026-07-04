export type AIProviderId =
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'amd-cloud';

export interface AIProviderMetadata {
  id: AIProviderId;
  label: string;
  shortLabel: string;
  keyPlaceholder: string;
  colorClass: string;
}

export const AI_PROVIDERS: readonly AIProviderMetadata[] = [
  {
    id: 'claude',
    label: 'Anthropic Claude',
    shortLabel: 'Claude',
    keyPlaceholder: 'sk-ant-api03-...',
    colorClass: 'text-orange-400',
  },
  {
    id: 'openai',
    label: 'OpenAI GPT-5.5',
    shortLabel: 'GPT-5.5',
    keyPlaceholder: 'sk-proj-...',
    colorClass: 'text-emerald-400',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    keyPlaceholder: 'AIzaSy...',
    colorClass: 'text-blue-400',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    colorClass: 'text-purple-400',
  },
  {
    id: 'amd-cloud',
    label: 'AMD Cloud (Qwen3-30B)',
    shortLabel: 'AMD',
    keyPlaceholder: 'No API key required',
    colorClass: 'text-red-400',
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