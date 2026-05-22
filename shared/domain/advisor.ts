import type { ModelAnalysis } from './analysis';
import type { AIProviderId } from './providers';

export type AdvisorLanguage = 'en' | 'ja' | 'zh';

export type AdvisorMessageRole = 'user' | 'assistant' | 'system';

export type AdvisorMessageSource = 'local' | AIProviderId;

export interface AdvisorMessage {
  id: string;
  role: AdvisorMessageRole;
  content: string;
  source?: AdvisorMessageSource;
  createdAt?: string;
}

export interface AdvisorContext {
  modelAnalysis: ModelAnalysis;
  language: AdvisorLanguage;
}

export interface AdvisorResponse {
  message: AdvisorMessage;
  usedAI: boolean;
  providerId?: AIProviderId;
}
