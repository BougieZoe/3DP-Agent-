import type { LoopState, VerificationResult } from "./types.js";
import { logSection } from "./utils/helpers.js";
import { attemptAutoFix } from "./fixers/typescript.js";
import { attemptLLMFix } from "./fixers/llm.js";

type Verifier = () => Promise<VerificationResult>;

export async function runLoop(
  goal: string,
  verifiers: Verifier[],
  maxRounds: number = 5
): Promise<LoopState> {
  let state: LoopState = {
    goal,
    round: 0,
    success: false,
    history: [],
    lastFeedback: undefined,
  };

  console.log(`[DEBUG] Starting loop: ${goal}`);

  for (let round = 1; round <= maxRounds; round++) {
    state.round = round;
    const roundOutputs: string[] = [];
    let roundSuccess = true;

    logSection(`Round ${round} starting`);

    for (const verifier of verifiers) {
      const result = await verifier();
      roundOutputs.push(result.output || "No output");

      if (!result.ok) {
        roundSuccess = false;
        state.lastFeedback = result.output || "Unknown verification error";
        console.log("❌ Verification failed");
        console.log(`[DEBUG] lastFeedback captured (${state.lastFeedback.length} chars)`);
        break;
      } else {
        console.log("✅ Verification passed");
      }
    }

    state.history = [...state.history, ...roundOutputs];

    if (roundSuccess) {
      state.success = true;
      console.log(`\n🎉 Goal completed after ${round} round(s)`);
      return state;
    }

    // If verification failed and we have rounds left, try to heal
    if (round < maxRounds && state.lastFeedback) {
      logSection("Self-Healing Action");
      console.log("→ Attempting heuristic auto-fixes...");
      const fixed = await attemptAutoFix(state.lastFeedback);

      if (fixed) {
        console.log("🔄 Re-running verification in the next round after heuristic fixes...");
        continue;
      }

      console.log("→ Heuristic fixes did not apply. Requesting LLM correction...");
      const diffGenerated = await attemptLLMFix(state.lastFeedback);

      if (diffGenerated) {
        console.log("🤖 LLM has generated a pending diff in loops/pending-fixes/.");
        console.log("⚠️ Please review and apply the diff manually to continue. Exiting loop.");
        break;
      } else {
        console.log("❌ LLM fixer was unable to suggest a unified diff. Exiting loop.");
        break;
      }
    }
  }

  console.log(`\n❌ Loop terminated after ${state.round} round(s)`);
  return state;
}