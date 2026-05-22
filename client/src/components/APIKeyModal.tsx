import { useState } from 'react';
import { getAPIKeys, saveAPIKeys } from '@/lib/apiKeys';
import { Language } from '@/lib/i18n';
import { AI_PROVIDERS } from '@shared/domain/providers';

interface APIKeyModalProps {
  onClose: () => void;
  language: Language;
}

const labels = {
  en: {
    header: 'API CONFIG',
    desc1: 'Keys stored locally in your browser. Never sent to our servers.',
    desc2: 'Add at least one key to unlock AI analysis.',
    hide: 'HIDE',
    show: 'SHOW',
    clear: 'CLR',
    save: 'SAVE KEYS',
    saved: '✓ SAVED',
  },
  ja: { /* 日文标签 */ },
  zh: { /* 中文标签 */ }
};

export function APIKeyModal({ onClose, language }: APIKeyModalProps) {
  const [keys, setKeys] = useState(getAPIKeys());
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const handleSave = () => {
    saveAPIKeys(keys);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">API Configuration</h2>
        
        {AI_PROVIDERS.map(provider => (
          <div key={provider.id} className="mb-4">
            <label className={`block text-sm mb-1.5 ${provider.colorClass}`}>{provider.label}</label>
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
        ))}

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
