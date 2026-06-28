export function summarizeTypeScriptErrors(output: string): string {
    const matches = output.match(/TS\d+:.*/g) ?? [];
    return matches.slice(0, 8).join("\n"); // 限制数量，避免太长
  }
  
  export function analyzeFeedback(feedback: string): string {
    if (feedback.includes("TS")) {
      return "TypeScript error detected";
    }
    if (feedback.includes("failed") || feedback.includes("error")) {
      return "Test or build failed";
    }
    return "Unknown issue";
  }