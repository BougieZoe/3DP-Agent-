export type LoopState = {
  goal: string;
  round: number;
  success: boolean;
  history: string[];
  lastFeedback?: string;
  nextAction?: string;
};

export type VerificationResult = {
  ok: boolean;
  output: string;
};