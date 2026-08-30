import { useState, useRef, useEffect } from 'react';
import { ModelData, classifyQuestion, answerLocally } from '@/lib/ruleEngine';
import { callAI, AIProvider } from '@/lib/apiKeys';
import { getLLMProvider } from '@/lib/llmAccess';
import { getAuthSnapshot } from '@/lib/authStore';
import { CONTENT, translate } from '@shared/i18n/content';
import { Language } from '@/lib/i18n';
import { AI_PROVIDER_METADATA } from '@shared/domain/providers';
import type { Material } from '@shared/domain/material';
import { DEFAULT_MATERIAL } from '@shared/domain/material';

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
  onNeedAuth: () => void;
  material?: Material;
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

// An unmeasured wall thickness (null) is reported honestly, never fabricated.
function minWallLabel(mm: number | null): string {
  return mm != null ? mm.toFixed(2) : '—';
}

function buildSystemPrompt(model: ModelData, lang: Language, material: Material = DEFAULT_MATERIAL): string {
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
Material: ${material.name} (overhang threshold: ${material.overhangThreshold}°, density: ${material.densityGPerCm3} g/cm³)
Volume: ${model.volume.toFixed(0)} mm³
Risk Assessment: ${riskLevel}

## GEOMETRY FINDINGS
Wall Thickness:
  - Minimum: ${minWallLabel(model.wallThickness.minThickness)} mm
  - Status: ${wallStatus.toUpperCase()}
  - Affected areas: ${model.wallThickness.areas}
  ${wallStatus === 'critical' ? translate(CONTENT, 'prompt.criticalWall', lang) : ''}
  ${wallStatus === 'warning' ? translate(CONTENT, 'prompt.warningWall', lang) : ''}

Overhang Analysis:
  - Faces beyond 45°: ${model.overhang.areas}
  - Status: ${overhangStatus.toUpperCase()}
  ${overhangStatus === 'critical' ? translate(CONTENT, 'prompt.criticalOverhang', lang) : ''}
  ${overhangStatus === 'warning' ? translate(CONTENT, 'prompt.warningOverhang', lang) : ''}

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

${translate(CONTENT, 'prompt.language', lang, {
    language: translate(CONTENT, 'prompt.languageName', lang),
  })}`;
}

function buildInitialAssessment(model: ModelData, lang: Language): string {
  const wallStatus = model.wallThickness.status;
  const overhangStatus = model.overhang.status;
  const hasCritical = wallStatus === 'critical' || overhangStatus === 'critical';
  const hasWarning = wallStatus === 'warning' || overhangStatus === 'warning';
  const dims = `${model.dims.x.toFixed(0)}×${model.dims.y.toFixed(0)}×${model.dims.z.toFixed(0)}mm`;
  const minWall = minWallLabel(model.wallThickness.minThickness);

  let text = translate(CONTENT, 'chat.assessment.scanned', lang, { file: model.fileName, dims });

  if (hasCritical) {
    text += translate(CONTENT, 'chat.assessment.criticalLead', lang);
    if (wallStatus === 'critical') text += translate(CONTENT, 'chat.assessment.criticalWall', lang, { t: minWall });
    if (overhangStatus === 'critical') text += translate(CONTENT, 'chat.assessment.criticalOverhang', lang, { faces: model.overhang.areas });
    text += translate(CONTENT, 'chat.assessment.criticalTail', lang);
  } else if (hasWarning) {
    text += translate(CONTENT, 'chat.assessment.warningLead', lang);
    if (wallStatus === 'warning') text += translate(CONTENT, 'chat.assessment.warningWall', lang, { t: minWall });
    if (overhangStatus === 'warning') text += translate(CONTENT, 'chat.assessment.warningOverhang', lang, { faces: model.overhang.areas });
    text += translate(CONTENT, 'chat.assessment.warningTail', lang);
  } else {
    text += translate(CONTENT, 'chat.assessment.good', lang);
  }

  return text;
}

export function ChatPanel({ model, language, onNeedAuth, material = DEFAULT_MATERIAL }: ChatPanelProps) {
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
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

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
    const { user } = getAuthSnapshot();

    if (!needsAI) {
      const localAnswer = answerLocally(category, model, language, material);
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

    // AI chat is a signed-in (hosted) feature. Anonymous users get a sign-in prompt.
    if (!user) {
      await new Promise(r => setTimeout(r, 300));
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_a',
        role: 'assistant',
        content: translate(CONTENT, 'chat.needSignIn', language),
        source: 'local',
      }]);
      setIsLoading(false);
      onNeedAuth();
      return;
    }

    const llm = getLLMProvider()!;
    try {
      const answer = await callAI(llm.provider, llm.key, buildSystemPrompt(model, language, material), text);
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_a',
        role: 'assistant',
        content: answer,
        source: llm.provider,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_err',
        role: 'assistant',
        content: translate(CONTENT, 'chat.errorPrefix', language, {
          message: err instanceof Error ? err.message : translate(CONTENT, 'chat.errorFallback', language),
        }),
        source: llm.provider,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoto = async (file: File | undefined) => {
    if (!file || !/^image\//.test(file.type)) return
    setPhotoLoading(true)
    try {
      // compress
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image load failed'))
        img.src = dataUrl
      })
      const maxDim = 640
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const compressed = canvas.toDataURL('image/jpeg', 0.8)

      const userMsg: Message = { id: Date.now().toString(), role: 'user', content: `📷 Failed print photo attached` }
      setMessages(prev => [...prev, userMsg])
      // reuse DiagnosisPanel's diagnose logic via direct call
      const { diagnosePrintFailure } = await import('@/lib/failureDiagnosis')
      const result = await diagnosePrintFailure(compressed, { language } as any)
      const diag = result.diagnosis
      const reply = diag ? `${diag.overallAssessment}\n\n${diag.failureModes.map(m => `· ${m.mode}: ${Math.round(m.probability*100)}% — ${m.fixes.slice(0,2).join(' / ')}`).join('\n')}` : 'Diagnosis failed — try again'
      setMessages(prev => [...prev, { id: Date.now().toString()+'_diag', role: 'assistant', content: reply, source: 'local' }])
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now().toString()+'_err', role: 'assistant', content: `Photo failed: ${e instanceof Error ? e.message : String(e)}`, source: 'local' }])
    } finally {
      setPhotoLoading(false)
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  const sourceColor = (src?: string) => {
    if (src === 'local') return 'text-muted-foreground/60';
    if (src && src in AI_PROVIDER_METADATA) return AI_PROVIDER_METADATA[src as AIProvider].colorClass;
    return 'text-primary';
  };

  return (
    <div className="flex flex-col h-full border border-border/20 rounded-sm bg-card/40 backdrop-blur-md shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span className="text-xs font-mono text-primary tracking-widest">{translate(CONTENT, 'chat.header', language)}</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground/40">
          {getLLMProvider() ? `AI: ${AI_PROVIDER_METADATA[getLLMProvider()!.provider].shortLabel}` : translate(CONTENT, 'chat.localMode', language)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'text-right' : ''}`}>
              {msg.role === 'assistant' && (
                <div className={`text-xs font-mono mb-1 ${sourceColor(msg.source)}`}>
                  {msg.source && msg.source !== 'local' ? `[${AI_PROVIDER_METADATA[msg.source].shortLabel}]` : translate(CONTENT, 'chat.localBadge', language)}
                </div>
              )}
              <div className={`text-xs font-mono leading-relaxed whitespace-pre-wrap px-3.5 py-2.5 shadow-sm backdrop-blur-md border ${
                msg.role === 'user'
                  ? 'bg-primary/15 text-foreground border-primary/20 rounded-2xl rounded-br-sm'
                  : 'bg-card/40 text-foreground/80 border-border/20 rounded-2xl rounded-bl-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="text-xs font-mono text-muted-foreground px-3.5 py-2.5 border border-border/20 rounded-2xl rounded-bl-sm bg-card/40 backdrop-blur-md shadow-sm">
              <span className="animate-pulse">{translate(CONTENT, 'chat.analyzing', language)}</span>
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

      <div className="px-3 pb-3 pt-2 flex gap-2 shrink-0 border-t border-border relative">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={translate(CONTENT, 'chat.placeholder', language) + '  ·  Ask or drop a failed photo'}
            className="w-full bg-background border border-border rounded-sm pl-3 pr-20 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
          />
          {/* 2: 聊天 App 右下角常驻 📷 + 🎤 */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => handlePhoto(e.target.files?.[0])} />
            <button
              onClick={() => photoRef.current?.click()}
              disabled={photoLoading}
              title="Upload failed print photo"
              className="w-7 h-7 flex items-center justify-center rounded-sm border border-border/40 bg-background text-muted-foreground hover:text-primary hover:border-primary/40 hover:scale-110 hover:bg-primary/5 transition-all duration-150 disabled:opacity-40"
            >
              {photoLoading ? '…' : '📷'}
            </button>
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className="w-7 h-7 flex items-center justify-center rounded-sm bg-primary text-primary-foreground text-xs disabled:opacity-30 hover:bg-primary/90 transition-all"
            >
              →
            </button>
          </div>
        </div>
      </div>
      <div className="px-3 pb-1 text-[10px] font-mono text-muted-foreground/20 text-center">📷 直接点相机传失败照片，不用跳大卡</div>
    </div>
  );
}