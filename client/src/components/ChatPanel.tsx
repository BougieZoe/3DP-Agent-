import { useState, useRef, useEffect } from 'react';
import { ModelData, classifyQuestion, answerLocally } from '@/lib/ruleEngine';
import { getActiveProvider, getKey, callAI, AIProvider } from '@/lib/apiKeys';
import { Language } from '@/lib/i18n';
import { AI_PROVIDER_METADATA } from '@shared/domain/providers';

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

const SUGGESTED: Record<Language, string[]> = {
  en: [
    'Where will this warp or fail first?',
    'Is PETG or PLA the right material?',
    'How do I reduce support material?',
    'What layer height gives the best tradeoff?',
    'Should I reorient this before slicing?',
  ],
  ja: [
    'どこが反りやすいですか？',
    'PETGかPLAどちらが適切ですか？',
    'サポート材を減らすには？',
    '最適なレイヤー高さは？',
    'スライス前に向きを変えるべきですか？',
  ],
  zh: [
    '这个模型哪里最容易翘曲或失败？',
    '这里用PETG还是PLA更合适？',
    '怎么减少支撑材料用量？',
    '最佳层高应该选多少？',
    '切片前需要调整摆放方向吗？',
  ],
};

function buildSystemPrompt(model: ModelData, lang: Language): string {
  const wallStatus = model.wallThickness.status;
  const overhangStatus = model.overhang.status;
  const hasCritical = wallStatus === 'critical' || overhangStatus === 'critical';
  const hasWarning = wallStatus === 'warning' || overhangStatus === 'warning';

  const riskLevel = hasCritical ? 'HIGH RISK' : hasWarning ? 'MODERATE RISK' : 'LOW RISK';

  return `You are a senior DfAM (Design for Additive Manufacturing) consultant with 15 years of experience across FDM, SLA, SLS, and MJF processes. You have reviewed thousands of files before they go to print. You are direct, specific, and you catch things others miss.

## YOUR ROLE
You are NOT a general AI assistant. You are a fabrication specialist reviewing this specific file. Your job is to reason from the geometry data below and give actionable manufacturing guidance — the kind a real consultant charges for.

## FILE UNDER REVIEW
Name: ${model.fileName}
Dimensions: ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm
Volume: ${model.volume.toFixed(0)} mm³
Risk Assessment: ${riskLevel}

## GEOMETRY FINDINGS
Wall Thickness:
  - Minimum: ${model.wallThickness.minThickness.toFixed(2)} mm
  - Status: ${wallStatus.toUpperCase()}
  - Affected areas: ${model.wallThickness.areas}
  ${wallStatus === 'critical' ? '⚠ CRITICAL: Walls below 0.8mm will not survive FDM printing. Structural failure likely.' : ''}
  ${wallStatus === 'warning' ? '⚠ WARNING: Some walls are thin. Material choice and orientation matter here.' : ''}

Overhang Analysis:
  - Faces beyond 45°: ${model.overhang.areas}
  - Status: ${overhangStatus.toUpperCase()}
  ${overhangStatus === 'critical' ? '⚠ CRITICAL: Severe overhangs detected. Support strategy is mandatory.' : ''}
  ${overhangStatus === 'warning' ? '⚠ WARNING: Moderate overhangs. Evaluate orientation before adding supports.' : ''}

## HOW YOU RESPOND
- Reason from the actual numbers above. Reference them when relevant.
- Give a clear verdict first, then explain why.
- When you recommend something, say what happens if they ignore it.
- Think about print orientation, not just geometry in abstract.
- Consider material properties when relevant (PLA vs PETG vs ABS vs resin).
- If something looks risky, say so directly. Do not hedge to be polite.
- Keep answers focused. No generic disclaimers. No "as an AI" language.
- You can ask one clarifying question if the intent is unclear — but answer first.
- Keep your reply under 120 words. No internal reasoning, no restating what
  was asked, no meta-commentary about your process — just the direct answer.

## LANGUAGE
Reply in ${lang === 'zh' ? 'Chinese (Simplified)' : lang === 'ja' ? 'Japanese' : 'English'}.`;
}

function buildInitialAssessment(model: ModelData, lang: Language): string {
  const wallStatus = model.wallThickness.status;
  const overhangStatus = model.overhang.status;
  const hasCritical = wallStatus === 'critical' || overhangStatus === 'critical';
  const hasWarning = wallStatus === 'warning' || overhangStatus === 'warning';
  const dims = `${model.dims.x.toFixed(0)}×${model.dims.y.toFixed(0)}×${model.dims.z.toFixed(0)}mm`;

  if (lang === 'zh') {
    if (hasCritical) {
      return `已扫描 ${model.fileName}（${dims}）。\n\n⚠ 发现严重问题：${
        wallStatus === 'critical' ? `最小壁厚 ${model.wallThickness.minThickness.toFixed(2)}mm，低于FDM可打印阈值。` : ''
      }${
        overhangStatus === 'critical' ? `检测到 ${model.overhang.areas} 个严重悬垂面。` : ''
      }\n\n打印前必须处理这些问题。你想先从哪里开始？`;
    }
    if (hasWarning) {
      return `已扫描 ${model.fileName}（${dims}）。\n\n模型基本可打印，但有几个需要注意的地方：${
        wallStatus === 'warning' ? `\n— 部分区域壁厚偏薄（最小 ${model.wallThickness.minThickness.toFixed(2)}mm），材料选择和摆放方向会影响结果` : ''
      }${
        overhangStatus === 'warning' ? `\n— ${model.overhang.areas} 个悬垂面超过45°，建议评估是否需要支撑` : ''
      }\n\n你想优先解决哪个问题？`;
    }
    return `已扫描 ${model.fileName}（${dims}）。\n\n几何结构良好——壁厚和悬垂角度都在可接受范围内。这个模型打印风险较低。\n\n你想讨论材料选择、打印参数，还是有其他问题？`;
  }

  if (lang === 'ja') {
    if (hasCritical) {
      return `${model.fileName}（${dims}）をスキャンしました。\n\n⚠ 重大な問題を検出：${
        wallStatus === 'critical' ? `最小肉厚 ${model.wallThickness.minThickness.toFixed(2)}mm はFDM印刷の閾値以下です。` : ''
      }${
        overhangStatus === 'critical' ? `${model.overhang.areas} 箇所の深刻なオーバーハングを検出。` : ''
      }\n\n印刷前にこれらを修正する必要があります。どこから確認しますか？`;
    }
    if (hasWarning) {
      return `${model.fileName}（${dims}）をスキャンしました。\n\n基本的には印刷可能ですが、注意点があります：${
        wallStatus === 'warning' ? `\n— 一部の壁が薄い（最小 ${model.wallThickness.minThickness.toFixed(2)}mm）。素材と向きの選択が重要です` : ''
      }${
        overhangStatus === 'warning' ? `\n— ${model.overhang.areas} 箇所が45°を超えるオーバーハング。サポートを検討してください` : ''
      }\n\nどこから対処しますか？`;
    }
    return `${model.fileName}（${dims}）をスキャンしました。\n\nジオメトリは良好です。肉厚とオーバーハングともに許容範囲内です。印刷リスクは低いと判断します。\n\n素材選択や印刷設定について質問はありますか？`;
  }

  if (hasCritical) {
    return `Scanned ${model.fileName} (${dims}).\n\n⚠ Critical issues found:${
      wallStatus === 'critical' ? `\n— Min wall thickness ${model.wallThickness.minThickness.toFixed(2)}mm — below the FDM survival threshold. These walls will not hold.` : ''
    }${
      overhangStatus === 'critical' ? `\n— ${model.overhang.areas} faces with severe overhang. Support strategy is not optional here.` : ''
    }\n\nThis needs to be addressed before you send this to a printer. What do you want to tackle first?`;
  }
  if (hasWarning) {
    return `Scanned ${model.fileName} (${dims}).\n\nPrintable, but there are things to watch:${
      wallStatus === 'warning' ? `\n— Some areas are thin (min ${model.wallThickness.minThickness.toFixed(2)}mm). Material choice and orientation will matter here.` : ''
    }${
      overhangStatus === 'warning' ? `\n— ${model.overhang.areas} faces beyond 45°. Worth evaluating orientation before committing to supports.` : ''
    }\n\nWhat do you want to dig into?`;
  }
  return `Scanned ${model.fileName} (${dims}).\n\nGeometry looks clean — wall thickness and overhangs are both within acceptable range. Low print risk.\n\nWhat do you want to talk through — material, settings, or something else?`;
}

export function ChatPanel({ model, language, onNeedAPIKey }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: buildInitialAssessment(model, language),
      source: 'local',
    },
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

    const { needsAI, category } = classifyQuestion(text);
    const provider = getActiveProvider();

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

    if (!provider) {
      await new Promise(r => setTimeout(r, 300));
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_a',
        role: 'assistant',
        content: language === 'zh'
          ? '这个问题需要AI推理。配置API Key后我可以给你更深入的制造分析。'
          : language === 'ja'
            ? 'この質問にはAI推論が必要です。API Keyを設定すると、より深い製造分析が可能になります。'
            : 'This needs AI reasoning. Add an API key and I can give you a proper fabrication analysis.',
        source: 'local',
      }]);
      setIsLoading(false);
      onNeedAPIKey();
      return;
    }

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
    if (src && src in AI_PROVIDER_METADATA) return AI_PROVIDER_METADATA[src as AIProvider].colorClass;
    return 'text-primary';
  };

  return (
    <div className="flex flex-col h-full border border-border rounded-sm bg-card">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span className="text-xs font-mono text-primary tracking-widest">FABRICATION CONSULTANT</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground/40">
          {getActiveProvider() ? `AI: ${AI_PROVIDER_METADATA[getActiveProvider()!].shortLabel}` : 'LOCAL MODE'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'text-right' : ''}`}>
              {msg.role === 'assistant' && (
                <div className={`text-xs font-mono mb-1 ${sourceColor(msg.source)}`}>
                  {msg.source && msg.source !== 'local' ? `[${AI_PROVIDER_METADATA[msg.source].shortLabel}]` : '[LOCAL]'}
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
              <span className="animate-pulse">▋ analyzing...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

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

      <div className="px-3 pb-3 pt-1 flex gap-2 shrink-0 border-t border-border">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder={
            language === 'zh' ? '问关于这个模型的制造问题...' :
            language === 'ja' ? 'このモデルの製造について質問...' :
            'Ask about this model...'
          }
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