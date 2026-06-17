/**
 * Sonar harness version — the methodology version stamped on every run
 * record and ledger row. Keep in sync with package.json.
 *
 * Versioning policy:
 *   - MINOR bump when results stop being comparable to prior runs: span
 *     definitions change, extraction logic changes, or the runner's timing
 *     model changes. The progression report draws a break line at minor
 *     boundaries.
 *   - PATCH bump for fixes that do not affect the numbers (logging, report
 *     formatting, CLI flags).
 *   - Suites version independently (see SonarSuite.version): editing a
 *     suite's turns or session count bumps the suite version, not Sonar's.
 */
export const SONAR_VERSION = "0.1.2";
