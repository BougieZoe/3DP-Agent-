export interface FeedbackEntry {
  id: string;
  title: string;
  description: string;
  type: 'bug' | 'feature' | 'general';
  context?: string;
  timestamp: string;
}

const STORAGE_KEY = '3dp-agent-feedback';

function loadFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown): e is FeedbackEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as FeedbackEntry).id === 'string' &&
        typeof (e as FeedbackEntry).title === 'string'
    );
  } catch {
    return [];
  }
}

function saveFeedback(entries: FeedbackEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // silently drop
  }
}

let feedbackEntries: FeedbackEntry[] = loadFeedback();

export function captureFeedback(
  title: string,
  description: string,
  type: FeedbackEntry['type'] = 'general',
  context?: string,
): FeedbackEntry {
  const entry: FeedbackEntry = {
    id: crypto.randomUUID(),
    title,
    description,
    type,
    context,
    timestamp: new Date().toISOString(),
  };
  feedbackEntries.push(entry);
  saveFeedback(feedbackEntries);
  return entry;
}

export function getFeedbackEntries(): FeedbackEntry[] {
  return [...feedbackEntries];
}

export function getFeedbackSummary(): string {
  if (feedbackEntries.length === 0) return 'No feedback collected.';
  const byType = (t: FeedbackEntry['type']) =>
    feedbackEntries.filter(e => e.type === t).length;
  return [
    `Feedback: ${feedbackEntries.length} entry(ies)`,
    `  Bugs: ${byType('bug')}`,
    `  Feature requests: ${byType('feature')}`,
    `  General: ${byType('general')}`,
    '',
    ...feedbackEntries.map((e, i) =>
      `  #${i + 1}: [${e.type}] ${e.title} (${new Date(e.timestamp).toLocaleDateString()})`
    ),
  ].join('\n');
}

export function clearFeedback(): void {
  feedbackEntries = [];
  saveFeedback(feedbackEntries);
}
