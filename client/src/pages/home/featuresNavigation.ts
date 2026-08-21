/**
 * PLACEHOLDER — first-pass item → destination mapping for the home Features
 * section. This is a best guess and is very likely to change. To re-target a
 * feature, edit a few lines in FEATURE_DESTINATIONS below; the click/animation
 * logic in FeaturesSection reads this table and stays untouched.
 *
 * Tab destinations mirror the tab state in Home.tsx. State-dependent behavior
 * (needsModel / requiresKey) is resolved by Home's navigation handler; this
 * file only declares intent.
 */

export type FeatureId = 'geometry' | 'quickReport' | 'qa' | 'deepChat' | 'optimize' | 'diagnose';

export type FeatureTab = 'geometry' | 'report' | 'chat' | 'agents' | 'causality';

export interface FeatureDestination {
  /** Tab to switch to when the click navigates. Omit to never switch tabs. */
  tab?: FeatureTab;
  /** Open a named standalone modal instead of switching tabs. */
  modal?: 'diagnose';
  /** Only navigates when a model is loaded; otherwise the click is tactile-only. */
  needsModel?: boolean;
  /** Requires an API key: open the key-setup modal instead when none is configured. */
  requiresKey?: boolean;
}

export const FEATURE_DESTINATIONS: Record<FeatureId, FeatureDestination> = {
  geometry:    { tab: 'geometry', needsModel: true },
  quickReport: { tab: 'report' },
  qa:          { tab: 'chat' },
  deepChat:    { tab: 'chat', requiresKey: true },
  // Optimization advisor results live under the AGENTS tab.
  optimize:    { tab: 'agents', requiresKey: true },
  // Failed-print photo diagnosis calls the hosted vision model (Kimi) — a
  // sign-in AI feature. Opens as a standalone modal so it works with zero
  // files uploaded (the chat tab itself needs a model).
  diagnose:    { modal: 'diagnose', requiresKey: true },
};
