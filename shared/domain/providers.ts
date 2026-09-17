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
  colorClass: string;
}

export const AI_PROVIDERS: readonly AIProviderMetadata[] = [
  {
    id: 'claude',
    label: 'Anthropic Claude',
    shortLabel: 'Claude',
    keyPlaceholder: 'sk-ant-api03-...',
    colorClass: 'text-orange-300',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    keyPlaceholder: 'sk-proj-...',
    colorClass: 'text-emerald-300',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    keyPlaceholder: 'AIzaSy...',
    colorClass: 'text-blue-300',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    colorClass: 'text-purple-300',
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    shortLabel: 'Kimi',
    keyPlaceholder: 'sk-...',
    colorClass: 'text-sky-300',
  },
  {
    id: 'amd-cloud',
    label: 'AMD Cloud',
    shortLabel: 'AMD',
    keyPlaceholder: 'No API key required',
    colorClass: 'text-red-300',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    shortLabel: 'Fireworks',
    keyPlaceholder: 'fw_...',
    colorClass: 'text-amber-300',
  },
  {
    id: 'zhipu',
    label: 'GLM (Zhipu)',
    shortLabel: 'GLM',
    keyPlaceholder: 'id.secret',
    colorClass: 'text-violet-300',
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