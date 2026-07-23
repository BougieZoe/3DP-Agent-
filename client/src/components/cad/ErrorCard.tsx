import { useState } from "react";
import { AlertTriangle, Server, Cpu, Clock, ChevronDown, ChevronRight } from "lucide-react";

/**
 * Categorizes a CAD generation error string into a user-friendly type.
 */
type ErrorKind = "bridge_down" | "llm_failed" | "generation_failed" | "timeout" | "unknown";

interface ErrorMeta {
  kind: ErrorKind;
  title: string;
  icon: typeof AlertTriangle;
  action: string;
}

function classifyError(msg: string): ErrorMeta {
  const lower = msg.toLowerCase();
  if (lower.includes("bridge not available") || lower.includes("is the server running")) {
    return {
      kind: "bridge_down",
      title: "CAD Bridge Unavailable",
      icon: Server,
      action: "Start the CAD bridge server:\nPORT=3001 npx tsx server/index.ts",
    };
  }
  if (lower.includes("no ai provider") || lower.includes("configure an api key")) {
    return {
      kind: "llm_failed",
      title: "No AI Provider Configured",
      icon: Cpu,
      action: "Configure an API key for OpenAI, DeepSeek, Kimi, or Fireworks in Settings.",
    };
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return {
      kind: "timeout",
      title: "Generation Timed Out",
      icon: Clock,
      action: "The CAD engine took too long. Try a simpler prompt or increase the timeout.",
    };
  }
  if (lower.includes("generation failed") || lower.includes("scripts/step") || lower.includes("exited with code")) {
    return {
      kind: "generation_failed",
      title: "Geometry Generation Failed",
      icon: AlertTriangle,
      action: "The CAD engine could not build valid geometry from this design. Try a different prompt or simplify the shape.",
    };
  }
  return {
    kind: "unknown",
    title: "Unexpected Error",
    icon: AlertTriangle,
    action: "Check the server logs for details.",
  };
}

export function ErrorCard({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const meta = classifyError(message);

  // Extract a short summary (first line or first 120 chars)
  const firstLine = message.split("\n").find((l) => l.trim().length > 0) ?? message;
  const summary = firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;

  return (
    <div className="px-4 mt-3">
      <div className="border border-red-500/20 bg-red-500/5 rounded-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 p-3">
          <meta.icon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-mono font-bold text-red-400">{meta.title}</div>
            <div className="text-xs text-red-400/60 mt-1 leading-relaxed">{summary}</div>
            <div className="text-xs text-red-400/30 mt-2 font-mono leading-relaxed whitespace-pre-wrap">
              {meta.action}
            </div>
          </div>
        </div>

        {/* Expandable technical details */}
        {message.split("\n").length > 3 && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center gap-1 px-3 py-1.5 border-t border-red-500/10 text-[11px] font-mono text-red-400/40 hover:text-red-400/70 hover:bg-red-500/5 transition-colors"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? "Hide" : "Show"} technical details
            </button>
            {expanded && (
              <pre className="px-3 py-2 text-[11px] font-mono text-red-400/30 leading-relaxed whitespace-pre-wrap border-t border-red-500/10 max-h-[200px] overflow-y-auto">
                {message}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
