import { collectAllViolations } from "../tests/helpers/source-scan";

/**
 * CI architecture gate (doc 18 §18.5).
 *
 * Runs the same scanner the architecture tests use, as a standalone command so the boundary
 * check can fail a pipeline without depending on the test runner.
 */
const violations = collectAllViolations();

if (violations.length === 0) {
  console.log("[boundaries] ok — no violations");
  process.exit(0);
}

console.error(`[boundaries] ${violations.length} violation(s):\n`);
for (const violation of violations) {
  console.error(`  ${violation.rule}\n    ${violation.file}\n    ${violation.detail}\n`);
}
process.exit(1);
