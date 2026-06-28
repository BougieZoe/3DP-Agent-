import {
  analyzeFeedback,
  attemptAutoFix,
  createPlan,
  logSection,
  runLoop,
  summarizeTypeScriptErrors,
  verifyTests,
  verifyTypecheck,
} from "./index.js";

async function main() {
  logSection("Goal Loop Started: Verify project health");

  const verifiers = [verifyTypecheck, verifyTests];

  let result = await runLoop("Verify project health", verifiers, 3);

  logSection("Loop Ended");
  console.log("Success:", result.success);
  console.log("Final Round:", result.round);

  if (!result.success && result.lastFeedback) {
    logSection("Analysis & Auto Fix Attempt");

    const analysis = analyzeFeedback(result.lastFeedback);
    const summary = summarizeTypeScriptErrors(result.lastFeedback);
    const plan = createPlan(result.lastFeedback);

    console.log("Issue:", analysis);
    if (summary) console.log("TS Errors:\n", summary);
    console.log("Suggested action:", plan.action);
    if (plan.suggestion) console.log("Suggestion:", plan.suggestion);

    const fixed = await attemptAutoFix(result.lastFeedback);

    if (fixed) {
      console.log("\n🔄 Re-running verification after fix...");
      result = await runLoop("Verify after auto fix", verifiers, 2);
    }
  } else if (result.success) {
    console.log("🎉 All checks passed successfully!");
  }

  console.log("\nFinal Result:", result.success ? "✅ SUCCESS" : "❌ FAILED");
}

main().catch(console.error);
