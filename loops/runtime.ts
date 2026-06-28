import type { LoopState, VerificationResult } from "./types.js";
import { logSection } from "./utils/helpers.js";

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

    if (round < maxRounds) {
      console.log(`\n⚠️ Round ${round} failed, trying again...`);
    }
  }

  console.log(`\n❌ Failed after ${maxRounds} rounds`);
  return state;
}