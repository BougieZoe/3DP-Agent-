export type TestDiagnostic = {
  filePath: string;
  line: number;
  column: number;
  message: string;
};

/**
 * Extracts test failure diagnostics from Vitest output.
 */
export function parseTestDiagnostics(output: string): TestDiagnostic[] {
  const diagnostics: TestDiagnostic[] = [];
  const lines = output.split(/\r?\n/);
  
  // Regex to match stack trace or error position references
  // e.g. " ❯ loops/fixers/__tests__/typescript.test.ts:43:20" or " at /path/to/file.ts:43:20"
  const locationRegex = /(?:❯|\bat\b)\s+([^\s()\n]+?\.(?:ts|tsx|js|jsx)):(\d+)(?::(\d+))?/;

  let currentMessage = "Test assertion failed";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect error titles or assertion descriptions in surrounding lines
    if (
      line.startsWith("AssertionError:") ||
      line.startsWith("Error:") ||
      line.startsWith("TypeError:") ||
      line.includes("expected") && (line.includes("to") || line.includes("equal"))
    ) {
      currentMessage = line;
    }

    const match = line.match(locationRegex);
    if (match) {
      const filePath = match[1];
      const lineNumber = Number(match[2]);
      const columnNumber = match[3] ? Number(match[3]) : 1;

      // Filter out node_modules paths to focus on user code
      if (!filePath.includes("node_modules")) {
        diagnostics.push({
          filePath,
          line: lineNumber,
          column: columnNumber,
          message: currentMessage,
        });
        
        // Reset currentMessage to default once consumed, or keep it if multiple trace lines occur
        currentMessage = "Test assertion failed";
      }
    }
  }

  return diagnostics;
}

/**
 * Summarizes the test failures for a concise console output.
 */
export function summarizeTestErrors(output: string): string {
  const diagnostics = parseTestDiagnostics(output);
  if (diagnostics.length === 0) {
    return "Vitest run failed with no parsed source code diagnostics.";
  }

  const summaries = diagnostics.slice(0, 5).map(d => {
    return `✗ ${d.filePath}:${d.line}:${d.column} - ${d.message}`;
  });

  if (diagnostics.length > 5) {
    summaries.push(`... and ${diagnostics.length - 5} more test error(s)`);
  }

  return summaries.join("\n");
}
