/**
 * pin-fixture — capture a REAL local transcript into the gitignored `real-local` corpus, scrubbed
 * and version-stamped. Reuses discover + scrub + observedVersions, so adding a new harness version is
 * a one-command change. It writes ONLY to the gitignored local corpus, NEVER the committed one — the
 * repo is public and `scrub` does not redact conversation/code.
 *
 * Usage:  npx tsx scripts/pin-fixture.ts [<transcript-path>]   (omit the path → most-recent session)
 *
 * After pinning, `p07-real-conformance.test.ts` reads the local corpus automatically (it is skipped
 * when absent). Inspect the scrubbed output before relying on it — scrub is paths/emails/keys only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubText, parseSession } from 'anatrace-core';
import { discoverByPath, discoverLast } from '../src/discover.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.join(here, '..', '..', 'core', 'test', 'fixtures', 'real-local');

const arg = process.argv[2];
const group = arg ? discoverByPath(arg) : discoverLast();
if (!group) {
  process.stderr.write('pin-fixture: no session found (pass a transcript path, or check ~/.claude / ~/.codex)\n');
  process.exit(1);
}
const session = parseSession(group.blobs, group.harness);
if (!session) {
  process.stderr.write('pin-fixture: could not parse the discovered session\n');
  process.exit(1);
}
const version = session.observedVersions[0] ?? 'unknown';
const outDir = path.join(OUT_ROOT, `${group.harness}@${version}`);
fs.mkdirSync(outDir, { recursive: true });
for (const blob of group.blobs) {
  const scrubbed = scrubText(new TextDecoder().decode(blob.bytes));
  const fileName = blob.name === 'parent' ? 'parent.jsonl' : blob.name.replace(/[/\\]/g, '__');
  fs.writeFileSync(path.join(outDir, fileName), scrubbed);
}
process.stdout.write(
  `pinned ${group.harness}@${version} (${group.blobs.length} blob(s)) → ${outDir}\n` +
    `  [scrubbed: paths/emails/keys only — inspect before trusting; gitignored, never committed]\n`,
);
