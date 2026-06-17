/**
 * 0a — the quote-aware THREE-TIER command matcher. Replaces the literal `.includes` on the whole
 * command string (which false-VIOLATEd a needle in a non-executed position, e.g. `echo "git push
 * --force"`). Resolves the EXECUTED command surface and returns one of three tiers:
 *
 *   'match'        -> the needle IS the executed command            (violated; force variants live here)
 *   'no-match'     -> the needle provably never executed            (satisfied; data / comment / unrelated)
 *   'unresolvable' -> obfuscation defeats a static surface          (unverifiable(command-unresolvable))
 *
 * THE LOAD-BEARING INVARIANT: a surface-extraction or quoting AMBIGUITY may only ever resolve to
 * 'match' or 'unresolvable' — NEVER 'no-match'. If the stripper mis-judged an executed command as
 * data, a real forbidden command would read clean: the cardinal sin, hidden inside the fix. Every
 * bias in this file is therefore toward 'match'/'unresolvable': unparseable quoting abstains; an
 * unrecognized quoted token defaults to COMMAND position (so the needle can only push to 'match');
 * any command-position shell expansion / substitution / eval / pipe-to-interpreter abstains.
 *
 * Narrowness (so the floor is not a sink): a DATA-position allowlist (the args of `echo`/`printf`,
 * and the value of a `-flag value` / `--flag=value`) is excluded from the surface, so the very common
 * `git commit -m "$MSG"` / `echo "$X"` patterns resolve 'no-match' rather than abstaining. Pure
 * string work — no shell exec, no fs/clock; the core purity wall holds.
 */

/** The three tiers. Caller maps: match->violated, no-match->satisfied, unresolvable->unverifiable. */
export type CommandMatchTier = 'match' | 'no-match' | 'unresolvable';

/**
 * Quote-aware top-level segmentation for FACTS projections (the M2 git-ops projection). Returns, per
 * top-level segment (split on `;` / newline / `&&` / `||` / `|`, QUOTE-AWARE), that segment's WORD
 * SURFACES (quotes resolved; an unresolved expansion/substitution rendered as the WILD sentinel; a
 * heredoc/here-string body consumed, never mis-tokenized as commands). This is the SAME lexer the
 * verdict-path command matcher uses, so a `git` token inside `echo "…; git push …"` data is NOT split
 * out as a phantom command (the naive `String.split` over-emission). Returns `[]` on unbalanced quoting
 * (bias: emit nothing rather than a phantom op from a half-parsed line). INTERNAL — not re-exported.
 */
export function commandSegments(command: string): string[][] {
  let segments: Segment[];
  try {
    segments = lex(command);
  } catch {
    return [];
  }
  return segments.map((s) => s.words.map((w) => w.surface));
}

/** A wildcard sentinel marking an unresolved expansion/substitution gap in a built surface. */
const WILD = '\u0001';

/** Programs whose arguments are pure DATA (never executed as a command). */
const DATA_PROGRAMS = new Set(['echo', 'printf', ':', 'true', 'false']);
/** Shell interpreters that execute a string / stdin / heredoc as commands. */
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ash', 'ksh', 'eval']);

/** One lexed word: its literal text plus whether a quoted run and/or an unquoted expansion appeared. */
interface Word {
  /** The word with quotes removed but their contents kept (shell concatenation), expansions -> WILD. */
  surface: string;
  /** True if any UNQUOTED `$…` / `$(…)` / backtick appeared in the word (the surface carries a WILD). */
  expansion: boolean;
}

/** One top-level command segment (split on `;` `&&` `||` `|` and newlines, quote-aware). */
interface Segment {
  words: Word[];
  /** Receives stdin from a `|` pipe (a pipe target). */
  pipeTarget: boolean;
  /** The segment opened a heredoc (`<<DELIM`). */
  heredoc: boolean;
  /** A structural parse problem made the segment un-tokenizable (bias: abstain). */
  opaque: boolean;
}

/** Thrown on unbalanced quoting/substitution — the caller maps it to 'unresolvable' (never satisfied). */
class ParseAmbiguity extends Error {}

/**
 * Lex a command string into top-level segments, quote-aware. Throws {@link ParseAmbiguity} on an
 * unterminated quote / substitution. Conservative by construction: anything it cannot resolve becomes
 * a WILD in the surface or an `opaque` segment, never silent removal.
 */
function lex(command: string): Segment[] {
  const segments: Segment[] = [];
  let words: Word[] = [];
  let curSurface = '';
  let curExpansion = false;
  let started = false; // whether the current word has any content yet
  let pipeTarget = false; // the NEXT segment is a pipe target if we split on `|`
  let nextPipeTarget = false;
  let curHeredoc = false; // the current segment reads a script from heredoc/here-string stdin
  let curOpaque = false; // the current segment hit a structural parse problem

  const pushWord = (): void => {
    if (started) {
      words.push({ surface: curSurface, expansion: curExpansion });
      curSurface = '';
      curExpansion = false;
      started = false;
    }
  };
  const pushSegment = (): void => {
    pushWord();
    segments.push({ words, pipeTarget, heredoc: curHeredoc, opaque: curOpaque });
    words = [];
    pipeTarget = nextPipeTarget;
    nextPipeTarget = false;
    curHeredoc = false;
    curOpaque = false;
  };

  const n = command.length;
  let i = 0;
  while (i < n) {
    const c = command[i]!;

    // Single quotes: literal, no expansion, no escapes. Unterminated -> ambiguity.
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) throw new ParseAmbiguity('unterminated single quote');
      curSurface += command.slice(i + 1, end);
      started = true;
      i = end + 1;
      continue;
    }
    // ANSI-C quotes $'...': literal-ish, no command expansion.
    if (c === '$' && command[i + 1] === "'") {
      const end = command.indexOf("'", i + 2);
      if (end === -1) throw new ParseAmbiguity('unterminated $\'\' quote');
      curSurface += command.slice(i + 2, end);
      started = true;
      i = end + 1; // `end` is the CLOSING quote; +1 lands just after it. (Was +2 — it swallowed the next
      //              char, so `git $'push' --force` mis-read as `git push--force` and FALSE-PASSed.)
      continue;
    }
    // Double quotes: contents kept; `$…`/`$(…)`/backtick inside still expand -> WILD.
    if (c === '"') {
      const r = scanDouble(command, i + 1);
      curSurface += r.surface;
      curExpansion = curExpansion || r.expansion;
      started = true;
      i = r.next;
      continue;
    }
    // Command substitution `$(…)` / process substitution `<(…)` / backticks -> a WILD gap.
    if (c === '$' && command[i + 1] === '(') {
      const end = matchParen(command, i + 1);
      if (end === -1) throw new ParseAmbiguity('unterminated $()');
      curSurface += WILD;
      curExpansion = true;
      started = true;
      i = end + 1;
      continue;
    }
    if (c === '`') {
      const end = command.indexOf('`', i + 1);
      if (end === -1) throw new ParseAmbiguity('unterminated backtick');
      curSurface += WILD;
      curExpansion = true;
      started = true;
      i = end + 1;
      continue;
    }
    if (c === '$') {
      // A variable expansion `$NAME` / `${NAME}` -> a WILD gap (could expand to anything).
      let j = i + 1;
      if (command[j] === '{') {
        const end = command.indexOf('}', j);
        if (end === -1) throw new ParseAmbiguity('unterminated ${}');
        j = end + 1;
      } else {
        while (j < n && /[A-Za-z0-9_]/.test(command[j]!)) j += 1;
      }
      curSurface += WILD;
      curExpansion = true;
      started = true;
      i = j;
      continue;
    }
    // Backslash escape (outside quotes): a `\<newline>` is a LINE CONTINUATION (the newline is removed,
    // so `git push \\\n--force` is one command); any other escaped char is literal.
    if (c === '\\') {
      if (command[i + 1] === '\n') {
        i += 2;
      } else if (i + 1 < n) {
        curSurface += command[i + 1];
        started = true;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    // A `#` at a word boundary starts a comment -> rest of the LINE is not executed.
    if (c === '#' && !started) {
      const nl = command.indexOf('\n', i);
      if (nl === -1) break;
      i = nl + 1;
      continue;
    }
    // Here-string `<<< data`: the program's stdin is a string. Mark the segment (matters only when the
    // program is an interpreter); the data word that follows is harmless. Skip the operator.
    if (c === '<' && command[i + 1] === '<' && command[i + 2] === '<') {
      pushWord();
      curHeredoc = true;
      i += 3;
      continue;
    }
    // Heredoc `<<[-]DELIM`: consume the BODY up to the delimiter line so it is never mis-parsed as
    // commands. Mark the segment (matters only when the program is an interpreter).
    if (c === '<' && command[i + 1] === '<') {
      pushWord();
      curHeredoc = true;
      i = consumeHeredoc(command, i + 2);
      continue;
    }
    // Top-level segment separators.
    if (c === ';' || c === '\n') {
      pushSegment();
      i += 1;
      continue;
    }
    if (c === '&' && command[i + 1] === '&') {
      pushSegment();
      i += 2;
      continue;
    }
    if (c === '|' && command[i + 1] === '|') {
      pushSegment();
      i += 2;
      continue;
    }
    if (c === '|') {
      nextPipeTarget = true;
      pushSegment();
      i += 1;
      continue;
    }
    // Redirections (`<` `>` `>>` `2>&1` `&>` `&>>` …) are WORD boundaries, not segment splits — splitting
    // on them would wrongly cut `… 2>&1 | tail`. Crucially the operator AND its target word must be
    // DROPPED, not lexed: a redirect can sit MID-command (`git push 2>/dev/null --force`, `git >log push
    // --force`), and injecting the fd-number / target into the surface between command words would break
    // needle contiguity and false-`no-match` a command that truly executes the needle.
    if (c === '<' || c === '>' || (c === '&' && (command[i + 1] === '>' || isFdRedirectStart(command, i)))) {
      // Drop a bare leading fd-number that belongs to this redirect (`2` of `2>err`), kept as the pending
      // word: a digits-only unquoted run immediately before the operator is the redirect fd, not a command
      // word. (A spaced number like `git 1 > x` is a real arg and was already pushed.)
      if (started && !curExpansion && /^[0-9]+$/.test(curSurface)) {
        curSurface = '';
        curExpansion = false;
        started = false;
      }
      pushWord();
      i = consumeRedirect(command, i);
      continue;
    }
    // A bare `&` that is not part of a redirect is a background/word boundary (true `&&` handled above).
    if (c === '&') {
      pushWord();
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      pushWord();
      i += 1;
      continue;
    }
    curSurface += c;
    started = true;
    i += 1;
  }
  pushSegment();
  return segments.filter((s) => s.words.length > 0 || s.heredoc);
}

/** Scan a double-quoted run starting AFTER the opening quote. Returns kept surface + next index. */
function scanDouble(command: string, start: number): { surface: string; expansion: boolean; next: number } {
  let surface = '';
  let expansion = false;
  let i = start;
  const n = command.length;
  while (i < n) {
    const c = command[i]!;
    if (c === '"') return { surface, expansion, next: i + 1 };
    if (c === '\\' && i + 1 < n) {
      surface += command[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = command.indexOf('`', i + 1);
      if (end === -1) throw new ParseAmbiguity('unterminated backtick in "..."');
      surface += WILD;
      expansion = true;
      i = end + 1;
      continue;
    }
    if (c === '$' && command[i + 1] === '(') {
      const end = matchParen(command, i + 1);
      if (end === -1) throw new ParseAmbiguity('unterminated $() in "..."');
      surface += WILD;
      expansion = true;
      i = end + 1;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      if (command[j] === '{') {
        const end = command.indexOf('}', j);
        if (end === -1) throw new ParseAmbiguity('unterminated ${} in "..."');
        j = end + 1;
      } else {
        while (j < n && /[A-Za-z0-9_]/.test(command[j]!)) j += 1;
      }
      surface += WILD;
      expansion = true;
      i = j;
      continue;
    }
    surface += c;
    i += 1;
  }
  throw new ParseAmbiguity('unterminated double quote');
}

/**
 * Consume a heredoc starting just AFTER the `<<` (at `start`): the optional `-`, the delimiter word,
 * and the body up to a line equal to the delimiter. Returns the index to continue lexing from (after
 * the closing delimiter line), so the body is never mis-parsed as commands. If the delimiter never
 * recurs, consumes to end. Pure index arithmetic — the body content is intentionally discarded.
 */
function consumeHeredoc(command: string, start: number): number {
  const n = command.length;
  let i = start;
  if (command[i] === '-') i += 1;
  while (i < n && /[ \t]/.test(command[i]!)) i += 1;
  // Read the delimiter token (quotes around it are allowed and stripped).
  let delim = '';
  while (i < n && !/[\s;|&<>]/.test(command[i]!)) {
    const c = command[i]!;
    if (c === '"' || c === "'") {
      const end = command.indexOf(c, i + 1);
      if (end === -1) break;
      delim += command.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    delim += c;
    i += 1;
  }
  if (delim === '') return i; // malformed — let the caller continue from here
  // Skip to the end of the current line, then scan for a line that is exactly the delimiter.
  let nl = command.indexOf('\n', i);
  if (nl === -1) return n;
  i = nl + 1;
  while (i <= n) {
    nl = command.indexOf('\n', i);
    const lineEnd = nl === -1 ? n : nl;
    if (command.slice(i, lineEnd).trim() === delim) return nl === -1 ? n : nl + 1;
    if (nl === -1) return n;
    i = nl + 1;
  }
  return n;
}

/** True if `&` at `i` opens a redirect operator (`&>` / `&>>`) rather than a bare/background `&`. */
function isFdRedirectStart(command: string, i: number): boolean {
  return command[i] === '&' && command[i + 1] === '>';
}

/**
 * Consume a redirection at `i` (the operator char) — operator and its target word — and return the
 * index to continue lexing from, so NEITHER enters the command surface. Handles `>` `>>` `<` `&>`
 * `&>>` `2>&1`-style fd dups, and an optional `>|` clobber. The target (a filename or `&fd`) is skipped
 * as one word. Quotes in the target are stepped over so a quoted path can't swallow the rest of the line.
 */
function consumeRedirect(command: string, i: number): number {
  const n = command.length;
  // Operator: a run of `<` `>` `&` `|` chars (covers `>` `>>` `<` `&>` `&>>` `>|` `<&` `>&`).
  while (i < n && (command[i] === '<' || command[i] === '>' || command[i] === '&' || command[i] === '|')) {
    i += 1;
  }
  // Skip whitespace between operator and target.
  while (i < n && /[ \t]/.test(command[i]!)) i += 1;
  // Skip exactly one target word (the filename / fd). Stop at whitespace or the next structural char so a
  // following command word (`git >log push`) is NOT swallowed.
  while (i < n && !/[\s;|&<>()]/.test(command[i]!)) {
    const c = command[i]!;
    if (c === '"' || c === "'") {
      const end = command.indexOf(c, i + 1);
      if (end === -1) return n; // unterminated quote in a redirect target — consume to end (bias: drop)
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return i;
}

/** Find the index of the `)` matching the `(` at `open` (which points at `(`), honoring nesting. */
function matchParen(command: string, open: number): number {
  let depth = 0;
  for (let i = open; i < command.length; i += 1) {
    if (command[i] === '(') depth += 1;
    else if (command[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Build the EXECUTED-command surface for one segment and match the needle. Command-position words
 * contribute their literal text (expansions -> WILD); DATA-position words are excluded:
 *  - the args of a data-program (`echo`/`printf`);
 *  - a message-flag value (`-m`/`--message`/`-F`/`--file` …), which is never executed;
 *  - a MULTI-WORD quoted argument — shell-correct: a quoted string is a SINGLE argument and its inner
 *    words are never executed as command words, so `git commit -m "git push --force"` is data, while a
 *    single-token quote like `git push "--force"` stays an executed token.
 *
 * THE INVARIANT GUARD (the subtle one): excluding a generic multi-word arg is only safe to call
 * 'no-match' when we KNOW the program treats it as data (a data-program or a message-flag value). For
 * an UNKNOWN program a quoted arg could be a command a wrapper executes (`xargs sh -c "git push
 * --force"`, `grep "git push --force"`). So if an excluded generic multi-word arg HID the needle, we
 * abstain ('unresolvable') rather than satisfy — never silently dropping a possibly-executed command.
 * Returns 'unresolvable' when the segment is OPAQUE (interpreter/eval over hidden input, an expansion
 * program token, or an unparseable construct).
 */
function executedSurface(seg: Segment, needle: string, exact: boolean): CommandMatchTier {
  if (seg.opaque) return 'unresolvable';
  const words = seg.words;
  if (words.length === 0) return 'no-match';
  const program = words[0]!;

  // Program identity unknown (it is an expansion / substitution) -> can't resolve what ran.
  if (program.expansion) return 'unresolvable';

  // An interpreter executing hidden input (piped stdin, a heredoc/here-string, or a non-literal `-c`).
  if (INTERPRETERS.has(program.surface)) {
    if (seg.pipeTarget || seg.heredoc) return 'unresolvable';
    const cArg = interpreterCommandArg(program.surface, words);
    if (cArg === null) return 'unresolvable'; // non-literal -c arg / bare eval
    if (cArg !== undefined) return classifyCommandMatch(cArg, needle, exact); // recurse into the literal
    return 'unresolvable'; // an interpreter we can't see the script of (e.g. `bash script.sh`)
  }
  if (seg.pipeTarget && seg.heredoc) return 'unresolvable';

  // `git` GLOBAL flags (`-c <v>` / `-C <v>` / valueless `--no-pager`) sit BEFORE the subcommand and
  // would break `git push` contiguity — skip them to the subcommand exactly as `meta/git-ops.ts` does,
  // so `git -c core.pager=cat push --force` resolves to the real force push (a latent false-negative
  // the old literal `.includes` also missed).
  const startArg = program.surface === 'git' ? gitSubcommandStart(words) : 1;

  const isDataProgram = DATA_PROGRAMS.has(program.surface);
  const isMessageProgram = MESSAGE_PROGRAMS.has(program.surface);
  const parts: string[] = [program.surface];
  let hiddenNeedle = false; // an excluded arg that could hide the needle on an unknown program (-> abstain)
  for (let k = startArg; k < words.length; k += 1) {
    const w = words[k]!;
    if (isDataProgram) continue; // a data-program's args are never executed (safe data)
    // A genuine commit/PR message value (`-m <v>` / `--message=<v>` / `-F <v>` …) is safe data ONLY for a
    // VCS-like program we KNOW treats it as a message. For an arbitrary command-runner the `-m` value can
    // be the EXECUTED template (`parallel -m "git push --force"`), so it must NOT be blanket-trusted —
    // it falls through to the generic multi-word handling below and abstains if it hides the needle.
    const afterMessageFlag = k > startArg && MESSAGE_FLAGS.has(words[k - 1]!.surface);
    if (isMessageProgram && (afterMessageFlag || isMessageEqToken(w.surface))) continue;
    if (/\s/.test(w.surface)) {
      // a MULTI-WORD QUOTED arg is a single argument, never executed as command words by a plain program.
      // Excluded from the surface, but if it HIDES the needle (a wrapper like `xargs sh -c "…"` or
      // `parallel -m "…"` could execute it) we abstain rather than silently satisfy.
      if (matchSurface(w.surface, needle, exact) !== 'no-match') hiddenNeedle = true;
      continue;
    }
    // A SINGLE word is a command-position token — even right after `-m`. A genuine message value is
    // quoted (handled above); an UNQUOTED token after `-m` (`parallel -m git push --force`) is a command
    // word, so it must stay in the surface or a real force-push would slip (the message-flag-drop trap).
    parts.push(w.surface);
  }
  const r = matchSurface(parts.join(' '), needle, exact);
  return r === 'no-match' && hiddenNeedle ? 'unresolvable' : r;
}

/** Flag whose VALUE is a message / file, never an executed command (so its value is safe data). */
const MESSAGE_FLAGS = new Set(['-m', '--message', '-F', '--file']);
/**
 * Programs we KNOW treat a `-m`/`--message`/`-F`/`--file` value as a commit/PR message (data). The
 * message-flag data-exclusion is restricted to these — for any OTHER program `-m`'s value could be an
 * executed command template (`parallel -m "…"`), so it must not be blanket-trusted as a message.
 */
const MESSAGE_PROGRAMS = new Set(['git', 'hg', 'jj', 'gh', 'svn', 'bzr', 'cvs']);

/** A `--message=…` / `-m=…` / `--file=…` token whose post-`=` value is safe data. */
function isMessageEqToken(surface: string): boolean {
  return /^(-m|--message|-F|--file)=/.test(surface);
}

/** Index of `git`'s subcommand: skip leading global flags (`-c <v>` / `-C <v>` take a value). */
function gitSubcommandStart(words: Word[]): number {
  let i = 1;
  while (i < words.length) {
    const w = words[i]!.surface;
    if (w === '-c' || w === '-C') i += 2;
    else if (w.startsWith('-')) i += 1;
    else break;
  }
  return i;
}

/**
 * The interpreter's command-string arg, if any:
 *  - returns the LITERAL command string when `sh -c "<literal>"` is fully literal (recurse into it);
 *  - returns `null` when the arg is non-literal (`-c "$X"`) or the program is a bare `eval` (dynamic);
 *  - returns `undefined` when there is no command-string arg (e.g. plain `bash`).
 */
function interpreterCommandArg(program: string, words: Word[]): string | null | undefined {
  if (program === 'eval') return null; // eval runs its concatenated args dynamically — beyond static reach
  for (let k = 1; k < words.length; k += 1) {
    if (words[k]!.surface === '-c') {
      const arg = words[k + 1];
      if (!arg) return null;
      return arg.expansion ? null : arg.surface;
    }
  }
  return undefined;
}

/** Match a built surface (with WILD gaps) against the needle. Literal hit -> match; WILD-reachable -> unresolvable. */
function matchSurface(surface: string, needle: string, exact: boolean): CommandMatchTier {
  const cleaned = surface;
  if (exact) {
    const literalParts = cleaned.split(WILD);
    if (literalParts.length === 1 && cleaned.trim() === needle) return 'match';
    // an exact match could still be realized if the whole surface is a single WILD-flexible string
    if (cleaned.includes(WILD) && exactReachable(cleaned, needle)) return 'unresolvable';
    return 'no-match';
  }
  // Substring direction: a literal occurrence inside one WILD-free chunk is a definite hit.
  for (const chunk of cleaned.split(WILD)) {
    if (chunk.includes(needle)) return 'match';
  }
  // Otherwise, if a WILD gap exists the needle could be realized inside it -> abstain.
  if (cleaned.includes(WILD)) return 'unresolvable';
  return 'no-match';
}

/** Could `needle` equal a realization of `cleaned` (WILD = any string)? Anchored regex test. */
function exactReachable(cleaned: string, needle: string): boolean {
  const pattern = '^' + cleaned.split(WILD).map(escapeRe).join('[\\s\\S]*') + '$';
  return new RegExp(pattern).test(needle);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify whether `needle` was executed in `command`, quote-aware. See the file header for the
 * three-tier contract and the load-bearing never-false-`no-match` invariant.
 *
 * @param command - the raw shell command string from a `Bash` / `exec_command` event
 * @param needle - the forbidden/required command substring (or exact string when `exact`)
 * @param exact - true for `equals`/`not_equals` (whole-command equality); false for `contains`/`not_contains`
 */
export function classifyCommandMatch(command: string, needle: string, exact: boolean): CommandMatchTier {
  let segments: Segment[];
  try {
    segments = lex(command);
  } catch {
    return 'unresolvable'; // unbalanced quoting — bias safe, never satisfied
  }
  let sawUnresolvable = false;
  for (const seg of segments) {
    const r = executedSurface(seg, needle, exact);
    if (r === 'match') return 'match'; // worst-wins
    if (r === 'unresolvable') sawUnresolvable = true;
  }
  return sawUnresolvable ? 'unresolvable' : 'no-match';
}
