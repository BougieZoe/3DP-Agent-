import {
  analyzeFeedback,
  createPlan,
  logSection,
  runLoop,
  summarizeTypeScriptErrors,
  summarizeTestErrors,
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
    logSection("Final Failure Analysis");

    const analysis = analyzeFeedback(result.lastFeedback);
    console.log("Issue Classification:", analysis);

    if (result.lastFeedback.includes("TS")) {
      const tsSummary = summarizeTypeScriptErrors(result.lastFeedback);
      if (tsSummary) console.log("Parsed TypeScript Errors:\n", tsSummary);
    } else {
      const testSummary = summarizeTestErrors(result.lastFeedback);
      if (testSummary) console.log("Parsed Test Failures:\n", testSummary);
    }

    const plan = createPlan(result.lastFeedback);
    console.log("Suggested plan action:", plan.action);
    if (plan.suggestion) console.log("Plan suggestion:", plan.suggestion);
  } else if (result.success) {
    console.log("🎉 All checks passed successfully!");
  }

  console.log("\nFinal Result:", result.success ? "✅ SUCCESS" : "❌ FAILED");
}

main().catch(console.error);

