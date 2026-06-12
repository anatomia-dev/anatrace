import type { MandateClaim } from './mandate.js';
import type { AgentRef, SessionEvent } from './session.js';
import type { VerdictReason } from './verdict.js';
import { commandStringOf } from './derive.js';

export type BehavioralChannel =
  | 'filesystem-read'
  | 'filesystem-write'
  | 'command-execution'
  | 'network-egress';

export type ChannelCoverageGapReason =
  | 'unknown-tool'
  | 'unsupported-shell-command'
  | 'ambiguous-read-tool'
  | 'unparseable-tool-input'
  | 'subject-unresolvable'
  | 'window-unresolvable';

export interface ChannelEvidencePointer {
  blobName: string;
  lineIndex: number;
  agent: AgentRef;
  eventType: SessionEvent['type'];
}

export interface ChannelCoverageGap {
  channel: BehavioralChannel;
  reason: ChannelCoverageGapReason;
  source: string;
  evidence?: ChannelEvidencePointer;
}

export interface ClaimChannelCoverage {
  claimId: string;
  requiredChannels: BehavioralChannel[];
  checkedChannels: BehavioralChannel[];
  gaps: ChannelCoverageGap[];
}

export interface VerificationCoverage {
  totalClaims: number;
  fullyCheckedClaims: number;
  unverifiableClaims: Array<{ claimId: string; reason: VerdictReason }>;
  claims: ClaimChannelCoverage[];
}

export interface ObservedRead {
  path: string;
  evidence: ChannelEvidencePointer;
}

export interface ObservedEgress {
  destination?: string;
  evidence: ChannelEvidencePointer;
}

export interface ChannelInspection {
  reads: ObservedRead[];
  egress: ObservedEgress[];
  gaps: ChannelCoverageGap[];
}

interface ShellWord {
  value: string;
  operator: boolean;
}

interface ShellInvocation {
  command: string;
  args: string[];
  redirectsIn: string[];
  redirectsOut: string[];
}

interface ReadParse {
  paths: string[];
  complete: boolean;
}

const CONTROL_TOOLS = new Set([
  'Agent',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Glob',
  'TodoWrite',
]);

const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);
const SHELL_TOOLS = new Set(['Bash', 'exec_command']);

const SHELL_READERS = new Set(['cat', 'head', 'tail']);
const SHELL_NO_CONTENT_READ = new Set([
  'basename',
  'cd',
  'date',
  'dirname',
  'echo',
  'ls',
  'printf',
  'pwd',
  'test',
]);
const SHELL_NO_WRITE = new Set([
  ...SHELL_NO_CONTENT_READ,
  'cat',
  'cut',
  'grep',
  'head',
  'jq',
  'paste',
  'rg',
  'sed',
  'sort',
  'tail',
  'tr',
  'uniq',
  'wc',
]);
const SHELL_NO_NETWORK = new Set([
  ...SHELL_NO_WRITE,
  'chmod',
  'cp',
  'mkdir',
  'mv',
  'rm',
  'tee',
  'touch',
]);
const SHELL_NETWORK = new Set([
  'curl',
  'ftp',
  'nc',
  'ncat',
  'rsync',
  'scp',
  'sftp',
  'ssh',
  'telnet',
  'wget',
]);

function pointer(event: SessionEvent): ChannelEvidencePointer {
  return {
    blobName: event.blobName,
    lineIndex: event.lineIndex,
    agent: event.agent,
    eventType: event.type,
  };
}

/**
 * Return the behavioral channels that must be complete for one transcript claim.
 *
 * @param claim - The declared policy claim.
 * @returns The closed channel set required to prove its negative conclusions.
 */
export function requiredChannelsForClaim(claim: MandateClaim): BehavioralChannel[] {
  if (claim.predicate?.scope !== 'transcript') return [];
  switch (claim.predicate?.target) {
    case 'read-paths':
      return ['filesystem-read'];
    case 'edit-paths':
      return ['filesystem-write'];
    case 'command-content':
      return ['command-execution'];
    case 'egress':
      return ['network-egress'];
    default:
      return [];
  }
}

/**
 * Build a typed incomplete receipt when identity or time scope cannot be resolved.
 *
 * @param claim - The claim whose scope could not be resolved.
 * @param reason - The closed scope-resolution reason.
 * @returns A claim-keyed channel coverage receipt.
 */
export function incompleteChannelCoverageForClaim(
  claim: MandateClaim,
  reason: 'subject-unresolvable' | 'window-unresolvable',
): ClaimChannelCoverage {
  const requiredChannels = requiredChannelsForClaim(claim);
  return {
    claimId: claim.id,
    requiredChannels,
    checkedChannels: [],
    gaps: requiredChannels.map((channel) => ({
      channel,
      reason,
      source: 'claim-scope',
    })),
  };
}

function shellWords(command: string): ShellWord[] | null {
  const out: ShellWord[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushWord = (): void => {
    if (current) out.push({ value: current, operator: false });
    current = '';
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      pushWord();
      continue;
    }
    if (';&|<>'.includes(ch)) {
      pushWord();
      const next = command[i + 1];
      const candidate = next ? ch + next : ch;
      const pair = ['&&', '||', '<<', '>>'].includes(candidate) ? candidate : ch;
      out.push({ value: pair, operator: true });
      if (pair.length === 2) i += 1;
      continue;
    }
    current += ch;
  }
  if (quote || escaped) return null;
  pushWord();
  return out;
}

function shellInvocations(command: string): ShellInvocation[] | null {
  const words = shellWords(command);
  if (!words) return null;
  const invocations: ShellInvocation[] = [];
  let segment: ShellWord[] = [];

  const flush = (): void => {
    const args: string[] = [];
    const redirectsIn: string[] = [];
    const redirectsOut: string[] = [];
    for (let i = 0; i < segment.length; i += 1) {
      const word = segment[i]!;
      if (word.operator) {
        if (word.value === '<' || word.value === '<<') {
          const target = segment[i + 1];
          if (target && !target.operator) {
            redirectsIn.push(target.value);
            i += 1;
          }
        } else if (word.value === '>' || word.value === '>>') {
          const target = segment[i + 1];
          if (target && !target.operator) {
            redirectsOut.push(target.value);
            i += 1;
          }
        }
        continue;
      }
      args.push(word.value);
    }
    while (args[0]?.includes('=') && !args[0].startsWith('=')) args.shift();
    const executable = args.shift();
    if (executable) {
      invocations.push({
        command: executable.split('/').pop() ?? executable,
        args,
        redirectsIn,
        redirectsOut,
      });
    }
    segment = [];
  };

  for (const word of words) {
    if (word.operator && (word.value === ';' || word.value === '&&' || word.value === '||' || word.value === '|')) {
      flush();
    } else {
      segment.push(word);
    }
  }
  flush();
  return invocations;
}

function nonOptionArgs(args: string[]): string[] {
  return args.filter((arg) => arg !== '-' && !arg.startsWith('-'));
}

function readerPaths(invocation: ShellInvocation): ReadParse {
  const { command, args } = invocation;
  if (command === 'cat') return { paths: nonOptionArgs(args), complete: true };
  if (command === 'head' || command === 'tail') {
    const files: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]!;
      if (arg === '-n' || arg === '--lines' || arg === '-c' || arg === '--bytes') {
        i += 1;
      } else if (!arg.startsWith('-') && arg !== '-') {
        files.push(arg);
      }
    }
    return { paths: files, complete: true };
  }
  if (command === 'sed') {
    const files: string[] = [];
    let scriptConsumed = false;
    let complete = true;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]!;
      if (arg === '-e' || arg === '--expression') {
        i += 1;
        scriptConsumed = true;
      } else if (arg === '-f' || arg === '--file') {
        const scriptFile = args[i + 1];
        if (scriptFile) files.push(scriptFile);
        i += 1;
        scriptConsumed = true;
      } else if (arg === '-n' || arg === '-E' || arg === '-r' || arg === '-u') {
        continue;
      } else if (arg.startsWith('-')) {
        complete = false;
      } else if (!scriptConsumed) {
        scriptConsumed = true;
      } else {
        files.push(arg);
      }
    }
    return { paths: complete ? files : [], complete };
  }
  if (command === 'grep' || command === 'rg') {
    const files: string[] = [];
    let patternConsumed = false;
    let complete = true;
    const valueOptions = new Set(
      command === 'grep'
        ? [
            '-A',
            '-B',
            '-C',
            '-D',
            '-d',
            '-m',
            '--after-context',
            '--before-context',
            '--binary-files',
            '--context',
            '--directories',
            '--exclude',
            '--exclude-dir',
            '--include',
            '--max-count',
          ]
        : [
            '-A',
            '-B',
            '-C',
            '-E',
            '-M',
            '-g',
            '-j',
            '-m',
            '-t',
            '-T',
            '--after-context',
            '--before-context',
            '--context',
            '--encoding',
            '--glob',
            '--max-columns',
            '--max-count',
            '--threads',
            '--type',
            '--type-not',
          ],
    );
    const flagOptions = new Set([
      '-F',
      '-H',
      '-I',
      '-L',
      '-P',
      '-U',
      '-V',
      '-a',
      '-c',
      '-h',
      '-i',
      '-l',
      '-n',
      '-o',
      '-q',
      '-s',
      '-v',
      '-w',
      '-x',
      '--fixed-strings',
      '--files-with-matches',
      '--files-without-match',
      '--ignore-case',
      '--line-number',
      '--no-filename',
      '--only-matching',
      '--quiet',
      '--recursive',
      '--word-regexp',
    ]);
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]!;
      if (arg === '-e' || arg === '--regexp') {
        i += 1;
        patternConsumed = true;
      } else if (arg === '-f' || arg === '--file') {
        const patternFile = args[i + 1];
        if (patternFile) files.push(patternFile);
        i += 1;
        patternConsumed = true;
      } else if (valueOptions.has(arg)) {
        i += 1;
      } else if (
        [...valueOptions].some((option) => arg.startsWith(`${option}=`)) ||
        flagOptions.has(arg)
      ) {
        continue;
      } else if (arg.startsWith('-')) {
        complete = false;
      } else if (!patternConsumed) {
        patternConsumed = true;
      } else {
        files.push(arg);
      }
    }
    return { paths: complete ? files : [], complete };
  }
  if (command === 'curl') {
    const files: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]!;
      if (arg === '-T' || arg === '--upload-file' || arg === '--data-binary' || arg === '--data') {
        const value = args[i + 1];
        if (value?.startsWith('@') && value.length > 1) files.push(value.slice(1));
        else if ((arg === '-T' || arg === '--upload-file') && value) files.push(value);
        i += 1;
      } else if (arg.startsWith('@') && arg.length > 1) {
        files.push(arg.slice(1));
      }
    }
    return { paths: files, complete: false };
  }
  if (command === 'wget') {
    const files: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]!;
      if (arg === '--post-file' || arg === '--body-file') {
        const value = args[i + 1];
        if (value) files.push(value);
        i += 1;
      }
    }
    return { paths: files, complete: false };
  }
  return { paths: [], complete: false };
}

function shellDestination(invocation: ShellInvocation): string | undefined {
  for (const arg of invocation.args) {
    if (/^(?:https?|ftp):\/\//i.test(arg)) return arg;
    if (/^[^@\s]+@[^:\s]+(?::|$)/.test(arg)) return arg;
  }
  return undefined;
}

function gitSubcommand(args: string[]): string | undefined {
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (!arg) return undefined;
    if (arg === '-C' || arg === '-c') {
      index += 2;
      continue;
    }
    if (arg.startsWith('-')) {
      index += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

function inspectShell(event: SessionEvent, command: string, out: ChannelInspection): void {
  if (command.includes('<<')) {
    for (const channel of [
      'filesystem-read',
      'filesystem-write',
      'command-execution',
      'network-egress',
    ] as const) {
      out.gaps.push({
        channel,
        reason: 'unsupported-shell-command',
        source: 'heredoc',
        evidence: pointer(event),
      });
    }
    return;
  }
  if (
    command.includes('$(') ||
    command.includes('<(') ||
    command.includes('>(') ||
    command.includes('`')
  ) {
    for (const channel of [
      'filesystem-read',
      'filesystem-write',
      'command-execution',
      'network-egress',
    ] as const) {
      out.gaps.push({
        channel,
        reason: 'unsupported-shell-command',
        source: 'command-substitution',
        evidence: pointer(event),
      });
    }
  }
  const invocations = shellInvocations(command);
  if (!invocations) {
    for (const channel of ['filesystem-read', 'network-egress'] as const) {
      out.gaps.push({
        channel,
        reason: 'unparseable-tool-input',
        source: event.type === 'tool' ? event.name : 'shell',
        evidence: pointer(event),
      });
    }
    return;
  }
  for (const invocation of invocations) {
    for (const path of invocation.redirectsIn) {
      out.reads.push({ path, evidence: pointer(event) });
    }
    const readParse = readerPaths(invocation);
    for (const path of readParse.paths) {
      out.reads.push({ path, evidence: pointer(event) });
    }
    if (
      (SHELL_READERS.has(invocation.command) ||
        invocation.command === 'sed' ||
        invocation.command === 'grep' ||
        invocation.command === 'rg') &&
      !readParse.complete
    ) {
      out.gaps.push({
        channel: 'filesystem-read',
        reason: 'ambiguous-read-tool',
        source: invocation.command,
        evidence: pointer(event),
      });
    }
    if (invocation.redirectsOut.length > 0 || !SHELL_NO_WRITE.has(invocation.command)) {
      out.gaps.push({
        channel: 'filesystem-write',
        reason: 'unsupported-shell-command',
        source: invocation.command,
        evidence: pointer(event),
      });
    }
    if (
      SHELL_NETWORK.has(invocation.command) ||
      (invocation.command === 'git' &&
        ['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(
          gitSubcommand(invocation.args) ?? '',
        ))
    ) {
      const destination = shellDestination(invocation);
      out.egress.push({
        ...(destination ? { destination } : {}),
        evidence: pointer(event),
      });
    }
    const readKnown =
      SHELL_READERS.has(invocation.command) ||
      invocation.command === 'sed' ||
      invocation.command === 'grep' ||
      invocation.command === 'rg' ||
      SHELL_NO_CONTENT_READ.has(invocation.command);
    if (!readKnown) {
      out.gaps.push({
        channel: 'filesystem-read',
        reason: 'unsupported-shell-command',
        source: invocation.command,
        evidence: pointer(event),
      });
    }
    const networkKnown =
      SHELL_NETWORK.has(invocation.command) ||
      SHELL_NO_NETWORK.has(invocation.command) ||
      (invocation.command === 'git' &&
        ['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(
          gitSubcommand(invocation.args) ?? '',
        ));
    if (!networkKnown) {
      out.gaps.push({
        channel: 'network-egress',
        reason: 'unsupported-shell-command',
        source: invocation.command,
        evidence: pointer(event),
      });
    }
  }
}

/**
 * Inspect normalized events for known reads, egress, and unclassified channel effects.
 *
 * @param events - The already subject/time-scoped canonical event timeline.
 * @returns Deterministic observations and typed coverage gaps.
 */
export function inspectBehavioralChannels(events: SessionEvent[]): ChannelInspection {
  const out: ChannelInspection = { reads: [], egress: [], gaps: [] };
  for (const event of events) {
    if (event.type === 'edit') continue;
    if (event.type !== 'tool') continue;
    if (event.name === 'Read') {
      const input = event.input;
      const path =
        typeof input === 'object' && input !== null
          ? (input as Record<string, unknown>)['file_path']
          : undefined;
      if (typeof path === 'string' && path) {
        out.reads.push({ path, evidence: pointer(event) });
      } else {
        out.gaps.push({
          channel: 'filesystem-read',
          reason: 'unparseable-tool-input',
          source: event.name,
          evidence: pointer(event),
        });
      }
      continue;
    }
    if (event.name === 'Grep') {
      const input = event.input;
      const path =
        typeof input === 'object' && input !== null
          ? (input as Record<string, unknown>)['path']
          : undefined;
      if (typeof path === 'string' && path) {
        out.reads.push({ path, evidence: pointer(event) });
      }
      out.gaps.push({
        channel: 'filesystem-read',
        reason: 'ambiguous-read-tool',
        source: event.name,
        evidence: pointer(event),
      });
      continue;
    }
    if (SHELL_TOOLS.has(event.name)) {
      const command = commandStringOf(event);
      if (!command) {
        for (const channel of ['filesystem-read', 'network-egress'] as const) {
          out.gaps.push({
            channel,
            reason: 'unparseable-tool-input',
            source: event.name,
            evidence: pointer(event),
          });
        }
      } else {
        inspectShell(event, command, out);
      }
      continue;
    }
    if (event.name.startsWith('mcp__')) {
      out.egress.push({ evidence: pointer(event) });
      for (const channel of [
        'filesystem-read',
        'filesystem-write',
        'command-execution',
      ] as const) {
        out.gaps.push({
          channel,
          reason: 'unknown-tool',
          source: event.name,
          evidence: pointer(event),
        });
      }
      continue;
    }
    if (NETWORK_TOOLS.has(event.name)) {
      out.egress.push({ evidence: pointer(event) });
      continue;
    }
    if (CONTROL_TOOLS.has(event.name)) continue;
    for (const channel of [
      'filesystem-read',
      'filesystem-write',
      'command-execution',
      'network-egress',
    ] as const) {
      out.gaps.push({
        channel,
        reason: 'unknown-tool',
        source: event.name,
        evidence: pointer(event),
      });
    }
  }
  const eventKey = (evidence: ChannelEvidencePointer): string =>
    `${evidence.blobName}:${evidence.lineIndex}:${evidence.agent.kind === 'root' ? 'root' : evidence.agent.subagentId}:${evidence.eventType}`;
  const seenReads = new Set<string>();
  out.reads = out.reads.filter((read) => {
    const key = `${read.path}:${eventKey(read.evidence)}`;
    if (seenReads.has(key)) return false;
    seenReads.add(key);
    return true;
  });
  const seenEgress = new Set<string>();
  out.egress = out.egress.filter((egress) => {
    const key = `${egress.destination ?? ''}:${eventKey(egress.evidence)}`;
    if (seenEgress.has(key)) return false;
    seenEgress.add(key);
    return true;
  });
  const seenGaps = new Set<string>();
  out.gaps = out.gaps.filter((gap) => {
    const key = `${gap.channel}:${gap.reason}:${gap.source}:${gap.evidence ? eventKey(gap.evidence) : ''}`;
    if (seenGaps.has(key)) return false;
    seenGaps.add(key);
    return true;
  });
  return out;
}

/**
 * Compute the channel receipt needed by one claim over its scoped timeline.
 *
 * @param claim - The policy claim being evaluated.
 * @param events - The subject/time-scoped canonical events.
 * @returns Required channels, checked channels, and typed gaps.
 */
export function channelCoverageForClaim(
  claim: MandateClaim,
  events: SessionEvent[],
): ClaimChannelCoverage {
  const requiredChannels = requiredChannelsForClaim(claim);
  const inspection = inspectBehavioralChannels(events);
  const gaps = inspection.gaps.filter((gap) => requiredChannels.includes(gap.channel));
  const incomplete = new Set(gaps.map((gap) => gap.channel));
  return {
    claimId: claim.id,
    requiredChannels,
    checkedChannels: requiredChannels.filter((channel) => !incomplete.has(channel)),
    gaps,
  };
}

/**
 * Summarize claim receipts for a report-level coverage line.
 *
 * @param totalClaims - Total claims in the evaluated mandate.
 * @param claims - One channel receipt per mandate claim.
 * @param unverifiableClaims - Closed verdict reasons for claims that could not be resolved.
 * @returns Stable aggregate and per-claim coverage.
 */
export function summarizeVerificationCoverage(
  totalClaims: number,
  claims: ClaimChannelCoverage[],
  unverifiableClaims: Array<{ claimId: string; reason: VerdictReason }> = [],
): VerificationCoverage {
  return {
    totalClaims,
    fullyCheckedClaims: totalClaims - unverifiableClaims.length,
    unverifiableClaims,
    claims,
  };
}
