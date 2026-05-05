import { useState } from 'react';
import { APIKeys, getAPIKeys, saveAPIKeys } from '@/lib/apiKeys';

interface APIKeyModalProps {
  onClose: () => void;
}

export function APIKeyModal({ onClose }: APIKeyModalProps) {
  const [keys, setKeys] = useState<APIKeys>(getAPIKeys());
  const [saved, setSaved] = useState(false);
  const [show, setShow] = useState<Record<string, boolean>>({});

  const handleSave = () => {
    saveAPIKeys(keys);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  const providers = [
    { id: 'claude' as const, label: 'Anthropic Claude', placeholder: 'sk-ant-api03-...', color: 'text-orange-400' },
    { id: 'openai' as const, label: 'OpenAI GPT-4o', placeholder: 'sk-proj-...', color: 'text-emerald-400' },
    { id: 'gemini' as const, label: 'Google Gemini', placeholder: 'AIzaSy...', color: 'text-blue-400' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 border border-primary/30 rounded-sm bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full" />
            <span className="text-xs font-mono text-primary tracking-widest">API CONFIG</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs font-mono">[ ESC ]</button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">
            {'>'} Keys stored locally in your browser. Never sent to our servers.<br />
            {'>'} Add at least one key to unlock AI analysis.
          </p>

          {providers.map(({ id, label, placeholder, color }) => (
            <div key={id} className="space-y-1.5">
              <label className={`text-xs font-mono ${color}`}>{label}</label>
              <div className="flex gap-2">
                <input
                  type={show[id] ? 'text' : 'password'}
                  value={keys[id] || ''}
                  onChange={e => setKeys(k => ({ ...k, [id]: e.target.value }))}
                  placeholder={placeholder}
                  className="flex-1 bg-background border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
                />
                <button
                  onClick={() => setShow(s => ({ ...s, [id]: !s[id] }))}
                  className="text-xs font-mono px-2 border border-border rounded-sm text-muted-foreground hover:text-foreground"
                >
                  {show[id] ? 'HIDE' : 'SHOW'}
                </button>
                {keys[id] && (
                  <button
                    onClick={() => setKeys(k => ({ ...k, [id]: '' }))}
                    className="text-xs font-mono px-2 border border-red-900/50 rounded-sm text-red-400 hover:bg-red-900/20"
                  >
                    CLR
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="pt-2 flex gap-3">
            <button
              onClick={handleSave}
              className={`flex-1 py-2 text-xs font-mono rounded-sm transition-all ${
                saved
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              {saved ? '✓ SAVED' : 'SAVE KEYS'}
            </button>
            <button onClick={onClose} className="px-4 py-2 text-xs font-mono border border-border rounded-sm text-muted-foreground hover:text-foreground">
              CANCEL
            </button>
          </div>

          <p className="text-xs text-muted-foreground/40 font-mono text-center">
            Get keys: console.anthropic.com · platform.openai.com · aistudio.google.com
          </p>
        </div>
      </div>
    </div>
  );
}
