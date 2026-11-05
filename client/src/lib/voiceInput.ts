/**
 * Voice Input Layer
 *
 * Provides speech recognition for AI voice control:
 * - Web Speech API integration
 * - Multi-language support (EN, JA, ZH)
 * - Real-time transcription
 * - Final result extraction
 */

export interface VoiceInputConfig {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

export interface VoiceController {
  isSupported: boolean;
  isListening: boolean;
  start: () => Promise<void>;
  stop: () => void;
  onResult: (callback: (transcript: string, isFinal: boolean) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
}

// Language mapping for Speech Recognition
const LANG_MAP: Record<string, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

/**
 * Check if speech recognition is supported
 */
export function isSpeechRecognitionSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );
}

/**
 * Create a voice input controller
 */
export function createVoiceController(config: VoiceInputConfig = {}): VoiceController {
  const {
    language = 'en',
    continuous = true,
    interimResults = true,
  } = config;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const isSupported = !!SpeechRecognition;

  let recognition: any = null;
  let listening = false;
  const resultCallbacks: Array<(transcript: string, isFinal: boolean) => void> = [];
  const errorCallbacks: Array<(error: string) => void> = [];

  function initRecognition(): void {
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = LANG_MAP[language] || language;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;

        for (const cb of resultCallbacks) {
          cb(transcript, isFinal);
        }
      }
    };

    recognition.onerror = (event: any) => {
      const error = event.error || 'Unknown error';
      for (const cb of errorCallbacks) {
        cb(error);
      }
    };

    recognition.onend = () => {
      // Auto-restart if continuous mode
      if (listening && continuous) {
        try {
          recognition.start();
        } catch {
          // Ignore — may already be started
        }
      }
    };
  }

  /**
   * Start listening
   */
  async function start(): Promise<void> {
    if (!isSupported) {
      throw new Error('Speech recognition not supported');
    }
    if (listening) return;

    initRecognition();
    if (!recognition) return;

    return new Promise((resolve, reject) => {
      recognition.onstart = () => {
        listening = true;
        resolve();
      };
      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          reject(new Error('Microphone access denied'));
        } else {
          for (const cb of errorCallbacks) {
            cb(event.error);
          }
        }
      };

      try {
        recognition.start();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop listening
   */
  function stop(): void {
    listening = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Register result callback
   */
  function onResult(callback: (transcript: string, isFinal: boolean) => void): () => void {
    resultCallbacks.push(callback);
    return () => {
      const idx = resultCallbacks.indexOf(callback);
      if (idx >= 0) resultCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register error callback
   */
  function onError(callback: (error: string) => void): () => void {
    errorCallbacks.push(callback);
    return () => {
      const idx = errorCallbacks.indexOf(callback);
      if (idx >= 0) errorCallbacks.splice(idx, 1);
    };
  }

  return {
    isSupported,
    get isListening() { return listening; },
    start,
    stop,
    onResult,
    onError,
  };
}

/**
 * Get supported languages for speech recognition
 */
export function getSupportedLanguages(): Array<{ code: string; name: string }> {
  return [
    { code: 'en', name: 'English' },
    { code: 'ja', name: 'Japanese' },
    { code: 'zh', name: 'Chinese' },
  ];
}
