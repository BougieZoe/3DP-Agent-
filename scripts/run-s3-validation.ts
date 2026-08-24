/**
 * S3 Validation Runner Script
 *
 * Runs the S3 validation harness and generates a report.
 */
import { runAllCases, generateReport, formatTextReport } from '../tests/harness/index';
import { testCases } from '../tests/harness/fixtures/useCases';

async function main() {
  console.log('Starting S3 validation...\n');

  try {
    // Run all test cases
    const results = await runAllCases(testCases, {
      verbose: true,
      concurrency: 1,
    });

    // Generate report
    const report = generateReport(results);

    // Print report
    console.log('\n' + formatTextReport(report, { verbose: true }));

    // Exit with appropriate code
    process.exit(report.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('S3 validation failed:', error);
    process.exit(1);
  }
}

main();
