import { useState, useEffect } from 'react';
import { getAPIKeys, saveAPIKeys, getSelectedProvider, setSelectedProvider } from '@/lib/apiKeys';
import { Language } from '@/lib/i18n';
import { AI_PROVIDERS } from '@shared/domain/providers';

interface APIKeyModalProps {
  onClose: () => void;
  language: Language;
}

interface ModelInfo {
  id: string;
  provider: string;
  label: string;
  source: string;
}

interface ProviderMeta {
  id: string;
  label: string;
  baseUrl: string;
  hasApiKey: boolean;
  modelCount: number;
}

const labels = {
  en: {
    header: 'API CONFIG',
    desc1: 'Keys stored locally in your browser. Relayed through our server per request — never stored server-side.',
    desc2: 'Add at least one key to unlock AI analysis.',
    hide: 'HIDE',
    show: 'SHOW',
    clear: 'CLR',
    save: 'SAVE KEYS',
    saved: '✓ SAVED',
    models: 'models',
    more: 'more',
  },
  ja: {
    header: 'API CONFIG',
    desc1: 'キーローカル保存。リレーのみ、サーバー保存なし。',
    desc2: 'AI解析にはキーを1つ以上追加してください。',
    hide: 'HIDE',
    show: 'SHOW',
    clear: 'CLR',
    save: 'SAVE KEYS',
    saved: '✓ SAVED',
    models: 'models',
    more: 'more',
  },
  zh: {
    header: 'API 配置',
    desc1: '密钥本地保存，仅通过服务器中转，不存储在服务器端。',
    desc2: '请添加至少一个密钥以解锁 AI 分析功能。',
    hide: '隐藏',
    show: '显示',
    clear: '清除',
    save: '保存密钥',
    saved: '✓ 已保存',
    models: '个模型',
    more: '更多',
  }
};

export function APIKeyModal({ onClose, language }: APIKeyModalProps) {
  const [keys, setKeys] = useState(getAPIKeys());
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState(
    getSelectedProvider() || AI_PROVIDERS.find(p => !!getAPIKeys()[p.id])?.id || AI_PROVIDERS[0].id
  );
  const [providerModels, setProviderModels] = useState<Record<string, ModelInfo[]>>({});
  const [providerMeta, setProviderMeta] = useState<Record<string, ProviderMeta>>({});
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});

  // Fetch model metadata on mount
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.models) {
          // Group models by provider
          const grouped: Record<string, ModelInfo[]> = {};
          data.models.forEach((m: ModelInfo) => {
            if (!grouped[m.provider]) grouped[m.provider] = [];
            grouped[m.provider].push(m);
          });
          // Sort each provider's models by released date (newest first)
          Object.keys(grouped).forEach(provider => {
            grouped[provider].sort((a, b) => {
              // API models first, then hardcoded
              if (a.source !== b.source) return a.source === 'api' ? -1 : 1;
              return a.id.localeCompare(b.id);
            });
          });
          setProviderModels(grouped);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch provider metadata
  useEffect(() => {
    fetch('/api/models/providers')
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.providers) {
          const meta: Record<string, ProviderMeta> = {};
          data.providers.forEach((p: ProviderMeta) => {
            meta[p.id] = p;
          });
          setProviderMeta(meta);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = () => {
    // AMD Cloud不需要key,但getActiveProvider()是靠"这个provider有没有值"
    // 来判断是否选中——空字符串等于没选。这里给它塞一个占位值,
    // 让它能被正常识别成"已启用",不需要用户手动打字。
    const keysToSave = { ...keys };
    if (!keysToSave['amd-cloud']) {
      keysToSave['amd-cloud'] = 'no-key-required';
    }
    saveAPIKeys(keysToSave);
    setSelectedProvider(activeProvider);
    onClose();
  };

  const getModels = (providerId: string): ModelInfo[] => {
    return providerModels[providerId] || [];
  };

  const toggleModels = (providerId: string) => {
    setExpandedModels(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-card border border-border rounded-lg w-full max-w-md p-6 my-6">
        <h2 className="text-lg font-semibold mb-4">API Configuration</h2>
        
        {AI_PROVIDERS.map(provider => {
          const models = getModels(provider.id);
          const meta = providerMeta[provider.id];
          const isExpanded = expandedModels[provider.id];
          
          return (
            <div key={provider.id} className="mb-4">
              <label className={`flex items-center gap-2 text-sm mb-1.5 ${provider.colorClass}`}>
                <input
                  type="radio"
                  name="active-provider"
                  checked={activeProvider === provider.id}
                  onChange={() => setActiveProvider(provider.id)}
                  className="accent-current"
                />
                {provider.label}
                {activeProvider === provider.id && (
                  <span className="text-[10px] opacity-70 font-normal">ACTIVE</span>
                )}
                {meta && meta.modelCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); toggleModels(provider.id); }}
                    className="text-[10px] opacity-50 font-normal hover:opacity-80 cursor-pointer"
                  >
                    [{meta.modelCount} {labels[language].models}]
                    <span className="ml-1">{isExpanded ? '▼' : '▶'}</span>
                  </button>
                )}
              </label>
              
              {/* Collapsible model list */}
              {isExpanded && models.length > 0 && (
                <div className="ml-6 mb-1.5 text-[11px] opacity-60 max-h-24 overflow-y-auto">
                  {models.map((m) => (
                    <div key={m.id} className="py-0.5">{m.label || m.id}</div>
                  ))}
                </div>
              )}
              
              <div className="flex gap-2">
                <input
                  type={showKeys[provider.id] ? 'text' : 'password'}
                  value={keys[provider.id] || ''}
                  onChange={(e) => setKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                  placeholder={provider.keyPlaceholder}
                  className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono"
                />
                <button
                  onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                  className="px-3 border border-border rounded text-xs"
                >
                  {showKeys[provider.id] ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          );
        })}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded font-medium">
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded font-medium"
          >
            Save Keys
          </button>
        </div>
      </div>
    </div>
  );
}