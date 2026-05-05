import { useState, useRef, useEffect } from 'react';
import { ModelData, classifyQuestion, answerLocally } from '@/lib/ruleEngine';
import { getActiveProvider, getKey, callAI, AIProvider } from '@/lib/apiKeys';
import { Language } from '@/lib/i18n';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source?: 'local' | AIProvider;
  loading?: boolean;
}

interface ChatPanelProps {
  model: ModelData;
  language: Language;
  onNeedAPIKey: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  openai: 'GPT-4o',
  gemini: 'Gemini',
  local: 'LOCAL',
};

const SUGGESTED: Record<Language, string[]> = {
  en: ['Can this model be printed?', 'What material should I use?', 'Do I need support structures?', 'Estimated print time?', 'Recommended print settings?'],
  ja: ['このモデルは印刷できますか？', 'どの素材を使うべきですか？', 'サポートは必要ですか？', '印刷時間の目安は？', '推奨設定を教えてください'],
  zh: ['这个模型能打印吗？', '推荐什么材料？', '需要支撑结构吗？', '预计打印时间？', '推荐的打印设置？'],
};

function buildSystemPrompt(model: ModelData, lang: Language): string {
  return `You are an expert 3D printing engineer. Answer concisely and technically.
Model: ${model.fileName}
Dims: ${model.dims.x.toFixed(1)}×${model.dims.y.toFixed(1)}×${model.dims.z.toFixed(1)}mm
Wall thickness: ${model.wallThickness.minThickness.toFixed(2)}mm (${model.wallThickness.status})
Overhang: ${model.overhang.areas} faces >45° (${model.overhang.status})
Volume: ${model.volume.toFixed(0)}mm³
Reply in ${lang === 'zh' ? 'Chinese (Simplified)' : lang === 'ja' ? 'Japanese' : 'English'}. Be direct and specific.`;
}

export function ChatPanel({ model, language, onNeedAPIKey }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: language === 'zh' ? '你好！我是3DP分析助手。你可以问我关于这个模型的任何问题。' :
        language === 'ja' ? 'こんにちは！3DP分析アシスタントです。このモデルについて何でも聞いてください。' :
        'Hello! I\'m your 3DP analysis assistant. Ask me anything about this model.',
      source: 'local',
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Classify question
    const { needsAI, category } = classifyQuestion(text);
    const provider = getActiveProvider();

    // Try local first
    if (!needsAI) {
      const localAnswer = answerLocally(category, model, language);
      if (localAnswer) {
        await new Promise(r => setTimeout(r, 400));
        setMessages(prev => [...prev, {
          id: Date.now().toString() + '_a',
          role: 'assistant',
          content: localAnswer,
          source: 'local',
        }]);
        setIsLoading(false);
        return;
      }
    }

    // Need AI — check if key exists
    if (!provider) {
      await new Promise(r => setTimeout(r, 300));
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_a',
        role: 'assistant',
        content: language === 'zh'
          ? '这个问题需要AI分析。请配置API Key以解锁高级分析功能。'
          : language === 'ja'
          ? 'この質問にはAI分析が必要です。API Keyを設定してください。'
          : 'This question requires AI analysis. Please configure your API key to unlock advanced analysis.',
        source: 'local',
      }]);
      setIsLoading(false);
      onNeedAPIKey();
      return;
    }

    // Call AI
    const key = getKey(provider)!;
    try {
      const answer = await callAI(provider, key, buildSystemPrompt(model, language), text);
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_a',
        role: 'assistant',
        content: answer,
        source: provider,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_err',
        role: 'assistant',
        content: `// ERROR: ${err instanceof Error ? err.message : 'API call failed'}`,
        source: provider,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sourceColor = (src?: string) => {
    if (src === 'local') return 'text-muted-foreground/60';
    if (src === 'claude') return 'text-orange-400';
    if (src === 'openai') return 'text-emerald-400';
    if (src === 'gemini') return 'text-blue-400';
    return 'text-primary';
  };

  return (
    <div className="flex flex-col h-full border border-border rounded-sm bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span className="text-xs font-mono text-primary tracking-widest">CHAT INTERFACE</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground/40">
          {getActiveProvider() ? `AI: ${PROVIDER_LABELS[getActiveProvider()!]}` : 'LOCAL MODE'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'text-right' : ''}`}>
              {msg.role === 'assistant' && (
                <div className={`text-xs font-mono mb-1 ${sourceColor(msg.source)}`}>
                  {msg.source ? `[${PROVIDER_LABELS[msg.source] || msg.source}]` : '[AI]'}
                </div>
              )}
              <div className={`text-xs font-mono leading-relaxed whitespace-pre-wrap px-3 py-2 rounded-sm ${
                msg.role === 'user'
                  ? 'bg-primary/10 text-foreground border border-primary/20'
                  : 'bg-background text-foreground/80 border border-border/50'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="text-xs font-mono text-muted-foreground px-3 py-2 border border-border/50 rounded-sm bg-background">
              <span className="animate-pulse">▋ processing...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
          {SUGGESTED[language].map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s)}
              className="text-xs font-mono px-2 py-1 border border-border/50 rounded-sm text-muted-foreground hover:text-primary hover:border-primary/30 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-1 flex gap-2 shrink-0 border-t border-border">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder={language === 'zh' ? '输入问题...' : language === 'ja' ? '質問を入力...' : 'Ask a question...'}
          className="flex-1 bg-background border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isLoading}
          className="px-3 py-2 text-xs font-mono bg-primary text-primary-foreground rounded-sm disabled:opacity-30 hover:bg-primary/90 transition-all"
        >
          →
        </button>
      </div>
    </div>
  );
}
