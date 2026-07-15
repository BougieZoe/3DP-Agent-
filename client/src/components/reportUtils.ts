import type { UnifiedAnalysis } from "../analysis/types";
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from "@/analysis/metrics";
import type { ToneMode, Language, TrafficLight, ChatMessage } from "./reportTypes";

// ─── Language Detection ─────────────────────────────────────────────────────────

export function detectLanguage(messages: ChatMessage[]): Language {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return japanesePattern.test(userText) ? "ja" : "en";
}

// ─── Tone Detection ────────────────────────────────────────────────────────────

export function detectTone(messages: ChatMessage[]): ToneMode {
  if (!messages.length) return "professional";
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  const expertTerms = [
    "topology", "manifold", "watertight", "overhang angle", "infill",
    "layer height", "retraction", "wall thickness", "stl", "mesh",
    "non-manifold", "boolean", "extrusion multiplier",
    "トポロジー", "マニフォールド", "オーバーハング", "インフィル",
  ];
  const expertScore = expertTerms.filter((t) => userText.includes(t)).length;
  const casualPatterns = [
    /\blol\b/, /\bomg\b/, /gonna/, /wanna/, /u r/, /thx/,
    /haha/, /ugh/, /basically/, /kinda/, /ya know/,
    /なんか/, /てか/, /じゃん/, /だよね/, /感じ/,
  ];
  const casualScore = casualPatterns.filter((p) => p.test(userText)).length;
  const avgWordLength =
    userText.split(/\s+/).reduce((sum, w) => sum + w.length, 0) /
    Math.max(userText.split(/\s+/).length, 1);
  if (expertScore >= 2 || avgWordLength > 8) return "expert";
  if (casualScore >= 2 || avgWordLength < 4) return "friendly";
  return "professional";
}

// ─── Traffic Light Score ───────────────────────────────────────────────────────

export function getTrafficLight(analysis: UnifiedAnalysis): {
  light: TrafficLight;
  score: number;
} {
  let score = 100;
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;

  if (v) {
    if (!v.isWatertight) score -= 30;
    if (v.holeCount > 0) score -= v.holeCount * 8;
    if (v.flippedNormalRatio > 0.1) score -= 15;
    if (v.degenerateFaceCount > 10) score -= 10;
  }

  if (m) {
    const wtStatus = deriveWtStatus(m.thinWallRatio ?? 0, m.p5WallThicknessMm);
    if (wtStatus === 'critical') score -= 30;
    else if (wtStatus === 'warning') score -= 15;
    if ((m.averageConfidence ?? 0) < 0.3 && (m.thinWallRatio ?? 0) < 0.02) score -= 3;
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') score -= 20;
    else if (ohStatus === 'warning') score -= 10;
  }

  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') score -= 20;
    else if (supportStatus.status === 'warning') score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  const light: TrafficLight =
    score >= 75 ? "green" : score >= 45 ? "yellow" : "red";

  return { light, score };
}

// ─── Weight / Time ranges ──────────────────────────────────────────────────────

export function computeWeightRange(grams: number): string {
  const lo = (grams * 0.05 * 1.2).toFixed(0);
  const hi = (grams * 1.0 * 1.2).toFixed(0);
  return `${lo}–${hi}g (varies by infill)`;
}

export function computeTimeRange(minutes: number): string {
  const lo = Math.round(minutes * 0.7);
  const hi = Math.round(minutes * 1.3);
  const f = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${f(lo)} – ${f(hi)} (excl. supports)`;
}

// ─── Issue Builders ────────────────────────────────────────────────────────────

export function buildClientIssues(analysis: UnifiedAnalysis, lang: Language): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;

  if (m) {
    const twr = (m.thinWallRatio ?? 0);
    const p5 = m.p5WallThicknessMm;
    const wtStatus = deriveWtStatus(twr, p5);
    if (wtStatus === 'critical') {
      issues.push(
        lang === "ja"
          ? `壁が薄すぎる領域が広範囲にあります (サンプルの${(twr * 100).toFixed(0)}%)。印刷中に破損の可能性。`
          : `${(twr * 100).toFixed(0)}% of sampled walls are below safe thickness — risk of print failure.`
      );
    } else if (wtStatus === 'warning') {
      issues.push(
        lang === "ja"
          ? `${(twr * 100).toFixed(0)}%の領域で壁が薄いです。印刷前に確認を推奨。`
          : `${(twr * 100).toFixed(0)}% of areas have thin walls — review recommended.`
      );
    } else if ((m.averageConfidence ?? 0) < 0.5) {
      issues.push(
        lang === "ja"
          ? `${m.minWallThicknessMm != null ? `最小壁厚 ${m.minWallThicknessMm.toFixed(2)}mm — ` : ''}信頼度が低いため、壁厚測定は参考値です。`
          : `${m.minWallThicknessMm != null ? `Min measured ${m.minWallThicknessMm.toFixed(2)}mm — ` : ''}Low confidence measurement, results are approximate.`
      );
    }
  }

  if (v && !v.isWatertight) {
    issues.push(
      lang === "ja"
        ? "モデルに隙間があり、完全に閉じていません。"
        : "The model has gaps — it's not fully closed."
    );
    if (v.holeCount > 0) {
      issues.push(
        lang === "ja"
          ? `${v.holeCount}ヶ所に穴があります。`
          : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found in the model.`
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      lang === "ja"
        ? `${v.holeCount}ヶ所に穴があります。`
        : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found in the model.`
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      lang === "ja"
        ? "一部の面が裏返しになっています。見た目に影響するかもしれません。"
        : "Some surfaces are facing the wrong way — this may affect appearance."
    );
  }

  if (m) {
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') {
      issues.push(
        lang === "ja"
          ? "大きく張り出した部分があります。サポート材が必要です。"
          : "Large overhanging areas will need support material."
      );
    } else if (ohStatus === 'warning') {
      issues.push(
        lang === "ja"
          ? "やや張り出した部分があります。サポート材を検討してください。"
          : "Some areas stick out — consider using supports."
      );
    }
  }

  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') {
      issues.push(
        lang === "ja"
          ? "サポート構造が複雑で、除去が難しい可能性があります。"
          : "Complex support structure — removal may be difficult."
      );
    } else if (supportStatus.status === 'warning' && supportStatus.reasons.length > 0) {
      issues.push(
        lang === "ja"
          ? `サポートに関する注意: ${supportStatus.reasons[0]}`
          : `Support caution: ${supportStatus.reasons[0]}`
      );
    }
  }

  return issues;
}

export function buildDesignerIssues(
  analysis: UnifiedAnalysis,
  _tone: ToneMode,
  lang: Language
): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;

  if (m) {
    const twr = (m.thinWallRatio ?? 0);
    const p5 = m.p5WallThicknessMm;
    const p10 = m.p10WallThicknessMm;
    const avg = m.avgWallThicknessMm;
    const conf = m.averageConfidence ?? 0;
    const wtStatus = deriveWtStatus(twr, p5);
    if (wtStatus === 'critical') {
      issues.push(
        lang === "ja"
          ? `壁厚: サンプルの${(twr * 100).toFixed(0)}%がFDM閾値未満 (p5=${(p5 ?? avg ?? 0).toFixed(2)} mm) — 広範囲に薄い壁`
          : `Walls: ${(twr * 100).toFixed(0)}% of samples below FDM threshold (p5=${(p5 ?? avg ?? 0).toFixed(2)} mm) — widespread thin walls`
      );
    } else if (wtStatus === 'warning') {
      const display = p10 ?? p5 ?? avg;
      issues.push(
        lang === "ja"
          ? `壁厚: ${(twr * 100).toFixed(0)}%の領域で薄い (p10=${(display ?? 0).toFixed(2)} mm)`
          : `Walls: ${(twr * 100).toFixed(0)}% of areas thin (p10=${(display ?? 0).toFixed(2)} mm)`
      );
    } else if (conf < 0.5) {
      issues.push(
        lang === "ja"
          ? `壁厚測定の信頼度が低い (${(conf * 100).toFixed(0)}%)。${m.minWallThicknessMm != null ? `最小測定値 ${m.minWallThicknessMm.toFixed(2)} mm は参考値として表示。` : ''}`
          : `Wall thickness confidence low (${(conf * 100).toFixed(0)}%). ${m.minWallThicknessMm != null ? `Min measured ${m.minWallThicknessMm.toFixed(2)} mm shown for reference.` : ''}`
      );
    }
  }

  if (v && !v.isWatertight) {
    issues.push(
      lang === "ja"
        ? "メッシュが密閉されていません。スライサーエラーの原因になります。"
        : "Mesh is not watertight. May cause slicing errors."
    );
    if (v.holeCount > 0) {
      issues.push(
        lang === "ja"
          ? `メッシュに${v.holeCount}個の穴があります。印刷前に修正してください。`
          : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found. Repair before slicing.`
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      lang === "ja"
        ? `メッシュに${v.holeCount}個の穴があります。印刷前に修正してください。`
        : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found. Repair before slicing.`
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      lang === "ja"
        ? `面の${(v.flippedNormalRatio * 100).toFixed(0)}% で法線が反転しています。スライスアーティファクトの原因に。`
        : `${(v.flippedNormalRatio * 100).toFixed(0)}% of faces have inverted normals. May cause slicing artifacts.`
    );
  }

  if (m) {
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') {
      issues.push(
        lang === "ja"
          ? "深刻なオーバーハング。サポート構造が必須です。"
          : "Severe overhang. Support structures are required."
      );
    } else if (ohStatus === 'warning') {
      issues.push(
        lang === "ja"
          ? "中程度のオーバーハング。サポート構造を推奨します。"
          : "Moderate overhang. Support structures are advisable."
      );
    }
  }

  const s = analysis.support?.result;
  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') {
      issues.push(
        lang === "ja"
          ? `${supportStatus.reasons[0] ?? 'サポート構造に問題があります'}`
          : `${supportStatus.reasons[0] ?? 'Support structure issue detected'}`
      );
    } else if (supportStatus.status === 'warning') {
      for (const reason of supportStatus.reasons.slice(0, 2)) {
        issues.push(
          lang === "ja"
            ? `サポート: ${reason}`
            : `Support: ${reason}`
        );
      }
    }
  }

  return issues;
}
