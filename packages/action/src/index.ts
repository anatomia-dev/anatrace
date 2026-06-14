/**
 * anatrace-action — reserved package slot for a future CI-gate GitHub Action.
 *
 * Foundation only: no Action logic yet (SARIF upload, sticky PR comment, exit codes)
 * — that ships in a later release. This stub reserves the package slot and the
 * dependency edge onto the CLI. The CLI already gates CI today.
 *
 * @returns A marker string identifying the not-yet-functional placeholder.
 */
export function placeholder(): string {
  return 'anatrace-action: not yet functional (the CI-gate Action ships in a later release)';
}
