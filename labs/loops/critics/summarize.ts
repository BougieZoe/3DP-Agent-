export function summarizeFailure(
    output: string,
  ): string {
    const lines = output
      .split("\n")
      .filter(Boolean)
      .slice(0, 20);
  
    return lines.join("\n");
  }