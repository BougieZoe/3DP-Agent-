/**
 * Voice Control Component
 *
 * Voice-activated control for 3D printing operations:
 * - Microphone button with waveform animation
 * - Real-time transcription display
 * - Intent confirmation cards
 * - Command history
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createVoiceController, type VoiceController } from '@/lib/voiceInput';
import { parseIntent, getSuggestedCommands, type UserIntent } from '@/lib/intentParser';
import { executeIntent, type ExecutionContext, type ActionResult } from '@/lib/actionExecutor';

interface VoiceControlProps {
  language?: string;
  context: ExecutionContext;
  onResult?: (result: ActionResult) => void;
}

export function VoiceControl({
  language = 'en',
  context,
  onResult,
}: VoiceControlProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [currentIntent, setCurrentIntent] = useState<UserIntent | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [history, setHistory] = useState<Array<{ intent: UserIntent; result: ActionResult }>>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const voiceRef = useRef<VoiceController | null>(null);

  // Load suggestions
  useEffect(() => {
    setSuggestions(getSupportedCommands(language));
  }, [language]);

  // Start listening
  const startListening = useCallback(async () => {
    try {
      const controller = createVoiceController({ language });
      await controller.start();
      voiceRef.current = controller;
      setIsListening(true);

      controller.onResult((text, isFinal) => {
        if (isFinal) {
          setTranscript(text);
          setInterimTranscript('');
          handleCommand(text);
        } else {
          setInterimTranscript(text);
        }
      });

      controller.onError((error) => {
        console.error('Voice error:', error);
        setIsListening(false);
      });
    } catch (err) {
      console.error('Failed to start voice:', err);
    }
  }, [language]);

  // Stop listening
  const stopListening = useCallback(() => {
    voiceRef.current?.stop();
    voiceRef.current = null;
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  // Handle a voice command
  const handleCommand = useCallback(async (text: string) => {
    const intent = await parseIntent(text);
    setCurrentIntent(intent);
  }, []);

  // Confirm and execute intent
  const confirmIntent = useCallback(async () => {
    if (!currentIntent) return;

    const result = await executeIntent(currentIntent, context);
    setLastResult(result);
    setHistory(prev => [...prev.slice(-9), { intent: currentIntent, result }]);
    setCurrentIntent(null);
    setTranscript('');
    onResult?.(result);
  }, [currentIntent, context, onResult]);

  // Cancel intent
  const cancelIntent = useCallback(() => {
    setCurrentIntent(null);
    setTranscript('');
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      voiceRef.current?.stop();
    };
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {/* Microphone Button */}
      <button
        onClick={isListening ? stopListening : startListening}
        className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
          isListening
            ? 'bg-red-500/20 border-2 border-red-500 text-red-400 animate-pulse'
            : 'bg-cyan-500/20 border-2 border-cyan-500 text-cyan-400 hover:bg-cyan-500/30'
        }`}
        title={isListening ? 'Stop listening' : 'Start voice command'}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      </button>

      {/* Waveform Animation */}
      {isListening && (
        <div className="absolute bottom-16 right-0 bg-background/95 border border-border/40 rounded-lg p-3 shadow-xl min-w-[200px]">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex gap-0.5">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-cyan-400 rounded-full animate-pulse"
                  style={{
                    height: `${8 + Math.random() * 16}px`,
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">Listening...</span>
          </div>

          {/* Interim transcript */}
          {interimTranscript && (
            <p className="text-sm text-muted-foreground italic mb-2">
              {interimTranscript}
            </p>
          )}

          {/* Final transcript */}
          {transcript && !currentIntent && (
            <p className="text-sm text-foreground mb-2">
              "{transcript}"
            </p>
          )}
        </div>
      )}

      {/* Intent Confirmation Card */}
      {currentIntent && (
        <div className="absolute bottom-16 right-0 bg-background/95 border border-border/40 rounded-lg p-4 shadow-xl w-72">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-mono font-semibold capitalize">
              {currentIntent.action}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              currentIntent.confidence >= 0.7
                ? 'bg-green-500/20 text-green-400'
                : 'bg-amber-500/20 text-amber-400'
            }`}>
              {Math.round(currentIntent.confidence * 100)}% confident
            </span>
          </div>

          <p className="text-sm text-muted-foreground mb-3">
            "{currentIntent.raw}"
          </p>

          {Object.keys(currentIntent.params).length > 0 && (
            <div className="mb-3 p-2 bg-muted/20 rounded text-xs font-mono">
              {Object.entries(currentIntent.params).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground">{key}:</span>
                  <span>{String(value)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={confirmIntent}
              className="flex-1 py-1.5 px-3 bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 rounded text-xs font-mono hover:bg-cyan-500/30 transition-colors"
            >
              Execute
            </button>
            <button
              onClick={cancelIntent}
              className="flex-1 py-1.5 px-3 bg-muted/20 border border-border/40 text-muted-foreground rounded text-xs font-mono hover:bg-muted/30 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Last Result */}
      {lastResult && !currentIntent && (
        <div className={`absolute bottom-16 right-0 bg-background/95 border rounded-lg p-3 shadow-xl w-64 ${
          lastResult.success
            ? 'border-green-500/40'
            : 'border-red-500/40'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={lastResult.success ? 'text-green-400' : 'text-red-400'}>
              {lastResult.success ? '✓' : '✕'}
            </span>
            <span className="text-sm font-mono">{lastResult.action}</span>
          </div>
          <p className="text-xs text-muted-foreground">{lastResult.message}</p>
        </div>
      )}

      {/* Suggested Commands */}
      {!isListening && !currentIntent && (
        <div className="absolute bottom-16 right-0 bg-background/95 border border-border/40 rounded-lg p-3 shadow-xl w-64">
          <div className="text-xs text-muted-foreground mb-2">Try saying:</div>
          <div className="space-y-1">
            {suggestions.slice(0, 3).map((cmd, idx) => (
              <button
                key={idx}
                onClick={() => handleCommand(cmd)}
                className="block w-full text-left text-xs text-foreground/80 hover:text-foreground p-1 rounded hover:bg-muted/20 transition-colors"
              >
                "{cmd}"
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getSupportedCommands(language: string): string[] {
  return getSuggestedCommands(language);
}
