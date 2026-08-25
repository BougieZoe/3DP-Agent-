/**
 * Webcam Capture Layer
 *
 * Provides camera access for Print Digital Twin:
 * - Start/stop webcam stream
 * - Capture frames for AI analysis
 * - Frame buffering for trend analysis
 */

export interface WebcamConfig {
  width?: number;
  height?: number;
  facingMode?: 'user' | 'environment';
  frameIntervalMs?: number;
}

export interface CapturedFrame {
  imageData: ImageData;
  timestamp: number;
  index: number;
}

export interface WebcamController {
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  isCapturing: boolean;
  start: () => Promise<void>;
  stop: () => void;
  captureFrame: () => CapturedFrame | null;
  getBuffer: () => CapturedFrame[];
  onFrame: (callback: (frame: CapturedFrame) => void) => () => void;
}

/**
 * Create a webcam controller
 */
export function createWebcamController(config: WebcamConfig = {}): WebcamController {
  const {
    width = 640,
    height = 480,
    facingMode = 'environment',
    frameIntervalMs = 5000,
  } = config;

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let captureCanvas: HTMLCanvasElement | null = null;
  let captureCtx: CanvasRenderingContext2D | null = null;
  let captureTimer: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;
  const buffer: CapturedFrame[] = [];
  const MAX_BUFFER = 10;
  const frameCallbacks: Array<(frame: CapturedFrame) => void> = [];

  /**
   * Start webcam stream
   */
  async function start(): Promise<void> {
    if (stream) return;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode,
        },
        audio: false,
      });

      // Create hidden video element
      video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      await video.play();

      // Create capture canvas
      captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth || width;
      captureCanvas.height = video.videoHeight || height;
      captureCtx = captureCanvas.getContext('2d');

      // Start periodic capture
      captureTimer = setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          buffer.push(frame);
          if (buffer.length > MAX_BUFFER) {
            buffer.shift();
          }
          for (const cb of frameCallbacks) {
            cb(frame);
          }
        }
      }, frameIntervalMs);

      // Capture first frame immediately
      const firstFrame = captureFrame();
      if (firstFrame) {
        buffer.push(firstFrame);
      }
    } catch (err) {
      console.error('[Webcam] Failed to start:', err);
      throw err;
    }
  }

  /**
   * Stop webcam stream
   */
  function stop(): void {
    if (captureTimer) {
      clearInterval(captureTimer);
      captureTimer = null;
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (video) {
      video.srcObject = null;
      video = null;
    }
    captureCanvas = null;
    captureCtx = null;
  }

  /**
   * Capture a single frame
   */
  function captureFrame(): CapturedFrame | null {
    if (!video || !captureCtx || !captureCanvas) return null;

    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const imageData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);

    const frame: CapturedFrame = {
      imageData,
      timestamp: Date.now(),
      index: frameIndex++,
    };

    return frame;
  }

  /**
   * Get the frame buffer
   */
  function getBuffer(): CapturedFrame[] {
    return [...buffer];
  }

  /**
   * Register frame callback
   */
  function onFrame(callback: (frame: CapturedFrame) => void): () => void {
    frameCallbacks.push(callback);
    return () => {
      const idx = frameCallbacks.indexOf(callback);
      if (idx >= 0) frameCallbacks.splice(idx, 1);
    };
  }

  return {
    get stream() { return stream; },
    get video() { return video; },
    get isCapturing() { return captureTimer !== null; },
    start,
    stop,
    captureFrame,
    getBuffer,
    onFrame,
  };
}

/**
 * Convert ImageData to base64 PNG for LLM Vision API
 */
export function imageDataToBase64(image: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Get available camera devices
 */
export async function getCameraDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'videoinput');
}
